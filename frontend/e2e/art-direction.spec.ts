import { expect, test, type Download, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { Asset, Bootstrap, Composition, Scene } from "../src/types";

async function downloadText(download: Download) {
  const stream = await download.createReadStream();
  let text = "";
  for await (const chunk of stream!) text += chunk;
  return text;
}

async function exportScene(page: Page): Promise<Scene> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать SVG", exact: true }).click();
  await page.getByRole("menuitem", { name: "Скачать JSON проекта" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  return JSON.parse(await downloadText(download));
}

async function expectOrdinaryScene(page: Page, scene: Scene, assets: Asset[]) {
  const board = page.getByTestId("artboard");
  await expect(board.locator("[data-element-id]")).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "Экспериментальная мастерская" }),
  ).toHaveCount(0);
  await expect(board.locator("[data-custom-shadow]")).toHaveCount(0);
  expect(scene.framing).toBe("bleed");
  const book = scene.elements.find((e) => e.family === "book")!;
  const phone = scene.elements.find((e) => e.family === "phone")!;
  expect(book.role).toBe("background");
  expect(phone.role).toBe("main");
  expect(book.x).toBeLessThan(0);
  expect(phone.support_ids).toEqual([book.id]);
  expect(phone.color_map).toEqual({ "object-0": "object-1" });
  for (const element of scene.elements) {
    const asset = assets.find(
      (asset) =>
        asset.family === element.family &&
        asset.detail === scene.detail &&
        asset.role === element.role,
    )!;
    const object = board.locator(`[data-element-id="${element.id}"]`);
    await expect(object).toHaveAttribute(
      "data-source-node",
      asset.source_node_id,
    );
    const transform = await object.evaluate((node) => {
      const matrix = (node as SVGGElement).transform.baseVal.consolidate()!
        .matrix;
      return { x: matrix.e, y: matrix.f, scale: matrix.a };
    });
    expect(transform.x).toBeCloseTo(element.x, 3);
    expect(transform.y).toBeCloseTo(element.y, 3);
    expect(transform.scale).toBeCloseTo(scene.scale, 3);
  }
}

test("ordinary art direction preserves source variants, crop, colors and project roundtrip", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(60000);
  await context.addCookies([
    { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:5178" },
  ]);
  await page.goto("/");
  await expect(page.getByTestId("artboard")).toBeVisible();
  const bootstrap: Bootstrap = await (
    await page.request.get("/api/bootstrap")
  ).json();
  await page.getByLabel("Размер холста").selectOption("square");
  await page.getByRole("tab", { name: "Предметы", exact: true }).click();
  await page
    .getByLabel("Описание композиции")
    .fill("телефон розовый на книге, книга фоновая за левый край");
  const compositionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/compose") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Собрать композицию", exact: true })
    .click();
  const response = await compositionResponse;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({
    mode: "components",
    use_ai: false,
  });
  const composition: Composition = await response.json();
  expect(composition.provider).toBe("components");
  expect(composition.scenes).toHaveLength(3);
  for (let variant = 1; variant <= 3; variant++) {
    if (variant > 1)
      await page
        .getByRole("button", {
          name: "Показать варианты композиции",
          exact: true,
        })
        .click();
    const choice = page.getByRole("button", {
      name: `Вариант композиции ${variant}`,
      exact: true,
    });
    await choice.click();
    await expect(choice).toBeHidden();
    await expectOrdinaryScene(
      page,
      composition.scenes[variant - 1],
      bootstrap.assets,
    );
  }
  await page.screenshot({
    path: resolve("../docs/evidence/art-direction-editor.png"),
    fullPage: true,
  });

  const before = await exportScene(page);
  await page.getByLabel("Размер холста").selectOption("portrait");
  const portrait = await exportScene(page);
  expect(portrait.scale).toBeCloseTo(before.scale * 0.8);
  for (const element of portrait.elements) {
    const previous = before.elements.find((e) => e.id === element.id)!;
    expect(element.x).toBeCloseTo(previous.x * 0.8, 3);
    expect(element.y).toBeCloseTo(600 + (previous.y - 500) * 0.8, 3);
  }
  await expectOrdinaryScene(page, portrait, bootstrap.assets);
  await page.getByRole("button", { name: "Детализация S" }).click();
  const small = await exportScene(page);
  expect(small.detail).toBe("S");
  expect(small.scale).toBeCloseTo(portrait.scale * 2);
  expect(small.elements).toEqual(portrait.elements);
  await expectOrdinaryScene(page, small, bootstrap.assets);

  const customPalette = {
    id: "art-direction-browser",
    name: "Цвета обычной композиции",
    background: ["#DAEEC9", "#9DBB91", "#3D5139", "#222222"],
    object: ["#FFD54F", "#FF69B4", "#4169E1", "#FFFFFF"],
  };
  await page.getByRole("button", { name: "Загрузить палитру" }).click();
  await page.getByRole("tab", { name: "Импорт JSON" }).click();
  await page.getByLabel("Импорт палитры").setInputFiles({
    name: "art-direction-palette.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(customPalette)),
  });
  await page.getByRole("button", { name: "Применить палитру" }).click();
  const board = page.getByTestId("artboard");
  await expect(board.locator("[data-background]")).toHaveAttribute(
    "fill",
    "#DAEEC9",
  );
  await expect
    .poll(() => board.locator('[data-family="phone"] [fill="#FF69B4"]').count())
    .toBeGreaterThan(0);
  await expect(
    board.locator('[data-family="book"] [fill="#FF69B4"]'),
  ).toHaveCount(0);
  const customized = await exportScene(page);
  expect(customized.palette.background).toEqual(customPalette.background);
  expect(customized.palette.object).toEqual(customPalette.object);
  expect(customized.elements).toEqual(small.elements);
  expect(customized.scale).toBe(small.scale);
  await page
    .getByLabel("Название проекта")
    .fill("Художественная композиция · обычный режим");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  const projectURL = page.url();
  const projectId = new URL(projectURL).searchParams.get("project")!;
  const stored = await (
    await page.request.get(`/api/projects/${projectId}`)
  ).json();
  expect(stored.scene.framing).toBe("bleed");
  expect(stored.scene.elements).toEqual(customized.elements);
  await page.reload();
  await expectOrdinaryScene(page, stored.scene, bootstrap.assets);
  await expect(board.locator("[data-background]")).toHaveAttribute(
    "fill",
    "#DAEEC9",
  );
  await page.screenshot({
    path: resolve("../docs/evidence/art-direction-custom-palette.png"),
    fullPage: true,
  });
  const exported = await exportScene(page);
  expect(exported).toEqual(stored.scene);

  const pendingSVG = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать SVG", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Скачать SVG", exact: true })
    .click();
  const svgDownload = await pendingSVG;
  expect(svgDownload.suggestedFilename()).toMatch(/\.svg$/);
  const svg = await downloadText(svgDownload);
  expect(svg).toContain("#FF69B4");
  expect(svg).toContain("#DAEEC9");
  expect(svg).not.toMatch(/<image|foreignObject|https:\/\/|data-custom-shadow/);
  const exportedGroups = await page.evaluate((svg) => {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (doc.querySelector("parsererror"))
      throw new Error("Export must be standalone valid SVG");
    return [...doc.querySelectorAll("[data-element-id]")].map((node) => ({
      id: node.getAttribute("data-element-id"),
      family: node.getAttribute("data-family"),
      role: node.getAttribute("data-role"),
    }));
  }, svg);
  expect(exportedGroups).toEqual(
    exported.elements.map(({ id, family, role }) => ({ id, family, role })),
  );
  await testInfo.attach("ordinary-art-direction.svg", {
    body: svg,
    contentType: "image/svg+xml",
  });
  await page.getByLabel("Импорт проекта").setInputFiles({
    name: "ordinary-art-direction.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page).not.toHaveURL(projectURL);
  await expectOrdinaryScene(page, exported, bootstrap.assets);
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  await page.reload();
  const restored = await exportScene(page);
  expect(restored).toEqual(exported);
  await expectOrdinaryScene(page, restored, bootstrap.assets);
});
