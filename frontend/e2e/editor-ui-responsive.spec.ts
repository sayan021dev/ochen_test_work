import { expect, test, type Page } from "@playwright/test";

async function start(page: Page) {
  await page
    .context()
    .addCookies([
      { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:5178" },
    ]);
  await page.goto("/");
  await expect(page.getByTestId("artboard")).toBeVisible();
}

// 720 × 450 CSS pixels is a 1440 × 900 browser window at 200% page zoom.
for (const viewport of [
  { width: 960, height: 500 },
  { width: 840, height: 450 },
  { width: 720, height: 450 },
  { width: 480, height: 320 },
  { width: 320, height: 450 },
]) {
  test(`panels keep their controls reachable at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await start(page);
    const toggle = page.getByRole("button", {
      name: "Идея и предметы",
      exact: true,
    });
    const panel = page.getByRole("complementary", {
      name: "Идея и библиотека",
      exact: true,
    });
    await expect(panel).toBeHidden();
    await toggle.click();
    await expect(panel).toBeVisible();
    await page.getByLabel("Описание композиции").fill("Лампа и книга");
    await panel
      .getByRole("button", { name: "Собрать композицию", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      panel.getByRole("button", { name: "Собрать композицию", exact: true }),
    ).toBeInViewport();
    // Browse to the bottom, then reopen: a previous scroll position must not hide the idea input.
    await panel
      .getByRole("button", { name: "Добавить Монета", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Закрыть библиотеку", exact: true }),
    ).toBeInViewport();
    await toggle.click();
    await toggle.click();
    await expect(page.getByLabel("Описание композиции")).toBeInViewport();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({
      path: `/private/tmp/ochen-ui-panel-${viewport.width}-${viewport.height}.png`,
    });
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(
      page.getByRole("complementary", { name: "Настройки композиции" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Закрыть настройки", exact: true })
      .click();
    await expect(
      page.getByRole("complementary", { name: "Настройки композиции" }),
    ).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/private/tmp/ochen-ui-${viewport.width}-${viewport.height}.png`,
    });
  });
}

test("variant previews collapse after selection, reopen unchanged and preserve undo", async ({
  page,
}) => {
  await start(page);
  // The components path is deterministic and never calls a paid AI provider.
  await page.getByRole("tab", { name: "Предметы", exact: true }).click();
  await page.getByLabel("Описание композиции").fill("Книга, лампа, монета");
  await page
    .getByRole("button", { name: "Собрать композицию", exact: true })
    .click();
  const variants = page.getByRole("region", {
    name: "Варианты композиции",
    exact: true,
  });
  const first = page.getByRole("button", {
    name: "Вариант композиции 1",
    exact: true,
  });
  const second = page.getByRole("button", {
    name: "Вариант композиции 2",
    exact: true,
  });
  await expect(first).toBeVisible();
  await expect(variants.locator(".variant-card")).toHaveCount(3);
  for (const card of await variants.locator(".variant-card").all()) {
    const number = await card.locator(".variant-number").boundingBox();
    const preview = await card.locator(".variant-preview").boundingBox();
    expect(preview!.y - number!.y - number!.height).toBeGreaterThanOrEqual(7);
  }
  const original = await page
    .getByTestId("artboard")
    .locator("[data-element-id]")
    .first()
    .getAttribute("transform");
  const previews = await variants
    .locator(".variant-preview")
    .evaluateAll((nodes) => nodes.map((n) => n.innerHTML));
  await page.screenshot({ path: "/private/tmp/ochen-ui-variants-desktop.png" });
  await second.click();
  await expect(second).toBeHidden();
  const collapsedType = await variants
    .locator(".variants-toggle > span")
    .evaluate((node) => ({
      main: parseFloat(getComputedStyle(node).fontSize),
      weight: Number(getComputedStyle(node).fontWeight),
      count: parseFloat(
        getComputedStyle(node.querySelector("small")!).fontSize,
      ),
    }));
  expect(collapsedType.main).toBeGreaterThanOrEqual(14);
  expect(collapsedType.weight).toBeGreaterThanOrEqual(600);
  expect(collapsedType.count).toBeGreaterThanOrEqual(13);
  await page.screenshot({
    path: "/private/tmp/ochen-ui-variants-collapsed.png",
  });
  await expect(
    page.getByRole("button", {
      name: "Показать варианты композиции",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(
    page.getByTestId("artboard").locator("[data-element-id]").first(),
  ).toHaveAttribute("transform", original!);
  await page
    .getByRole("button", { name: "Показать варианты композиции", exact: true })
    .click();
  await expect(second).toBeVisible();
  expect(
    await variants
      .locator(".variant-preview")
      .evaluateAll((nodes) => nodes.map((n) => n.innerHTML)),
  ).toEqual(previews);
  await first.click();
  await expect(first).toBeHidden();
  await page
    .getByRole("button", { name: "Показать варианты композиции", exact: true })
    .click();
  await first.click();
  await expect(first).toBeHidden();
  await page.setViewportSize({ width: 720, height: 450 });
  await page
    .getByRole("button", { name: "Показать варианты композиции", exact: true })
    .click();
  await expect(second).toBeInViewport();
  await expect(page.getByTestId("canvas-scroll")).toBeInViewport();
  const canvasSize = await page.getByTestId("canvas-scroll").boundingBox();
  expect(canvasSize!.height).toBeGreaterThanOrEqual(100);
  await page
    .getByRole("button", { name: "Увеличить масштаб просмотра", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Вписать в окно",
      exact: true,
    }),
  ).toContainText("110%");
  await page.screenshot({ path: "/private/tmp/ochen-ui-variants-720.png" });
});
