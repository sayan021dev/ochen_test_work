import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { enterExperiment } from "./helpers/experimental";
import type { Scene } from "../src/types";
const catalog = JSON.parse(readFileSync("../assets/catalog.json", "utf8"));
const scene: Scene = {
  version: 1,
  title: "Обычная композиция",
  format: "landscape",
  detail: "L",
  scale: 0.25,
  palette: catalog.palettes[0],
  transparent: false,
  light: { enabled: true, x: 200, y: 90, height: 1600, opacity: 0.4 },
  elements: [
    {
      id: "phone",
      family: "phone",
      role: "main",
      x: 140,
      y: 320,
      angle: 0,
      hidden: false,
      locked: false,
    },
    {
      id: "lamp",
      family: "lamp",
      role: "main",
      x: 250,
      y: 40,
      angle: 0,
      hidden: false,
      locked: false,
      support_ids: ["phone"],
      shadow: { angle: 120, length: 1.4, opacity: 0.65 },
    },
  ],
};
test("saved experiments stay dormant in normal mode and the screenshot guide opens only by explicit entry", async ({
  page,
}, testInfo) => {
  await page
    .context()
    .addCookies([
      { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:5178" },
    ]);
  await page.route("**/api/projects/experimental-workspace", (route) =>
    route.fulfill({
      json: {
        id: "experimental-workspace",
        scene,
        revision: 1,
        updated_at: "2026-11-10T00:00:00Z",
      },
    }),
  );
  await page.goto("/?project=experimental-workspace");
  const board = page.getByTestId("artboard");
  await expect(page.getByLabel("Название проекта")).toHaveValue(scene.title);
  await expect(
    page.getByLabel("Общий источник света", { exact: true }),
  ).toHaveCount(0);
  await expect(board.locator("[data-custom-shadow]")).toHaveCount(0);
  await expect(board.locator("[data-contact-shadow-owner]")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Открыть эксперимент", exact: true })
    .click();
  const guide = page.getByRole("dialog", {
    name: "Свет и тень: короткий маршрут",
  });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("img")).toBeVisible();
  await expect
    .poll(() =>
      guide
        .getByRole("img")
        .evaluate(
          (image) =>
            (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth === 840,
        ),
    )
    .toBe(true);
  await guide
    .getByRole("button", { name: "Подробнее: Общий источник света" })
    .click();
  await expect(guide.getByRole("status")).toContainText("Показать в редакторе");
  await expect(guide.locator(".experiment-guide-arrow")).toBeVisible();
  await expect(
    guide.getByRole("button", { name: "Назад", exact: true }),
  ).toBeDisabled();
  await guide.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(
    guide.getByRole("heading", { name: "Переместите солнце" }),
  ).toBeVisible();
  await guide.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(
    guide.getByRole("heading", { name: "Включите общий свет" }),
  ).toBeVisible();
  await guide
    .getByRole("button", { name: "Шаг 4: Своя тень предмета" })
    .click();
  await expect(
    guide.getByRole("heading", { name: "Своя тень предмета" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("experimental-guide.png"),
  });
  await guide.getByRole("button", { name: "Показать в редакторе" }).click();
  await expect(guide).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "Экспериментальная мастерская" }),
  ).toBeVisible();
  await expect(page.getByLabel("Своя тень", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Вернуться в обычный редактор", exact: true })
    .click();
  await expect(board.locator("[data-custom-shadow]")).toHaveCount(0);
  await expect(board.locator("[data-contact-shadow-owner]")).toHaveCount(1);
  await expect(page.getByLabel("Своя тень", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Название проекта")).toHaveValue(scene.title);
  await expect(board.locator("[data-custom-shadow]")).toHaveCount(0);
  await expect(guide).not.toBeVisible();
});

test("normal save and export preserve dormant settings while experimental export requires an explicit workspace", async ({
  page,
}) => {
  await page
    .context()
    .addCookies([
      { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:5178" },
    ]);
  let stored = structuredClone(scene);
  await page.route("**/api/projects/experimental-workspace", (route) => {
    if (route.request().method() === "PUT")
      stored = route.request().postDataJSON().scene;
    return route.fulfill({
      json: {
        id: "experimental-workspace",
        scene: stored,
        revision: 2,
        updated_at: "2026-11-10T00:00:00Z",
      },
    });
  });
  const exports: string[] = [];
  await page.route("**/api/export*", (route) => {
    exports.push(route.request().url());
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" />',
    });
  });
  await page.goto("/?project=experimental-workspace");
  await expect(page.getByLabel("Название проекта")).toHaveValue(scene.title);
  const exportSVG = async () => {
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Скачать SVG", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Скачать SVG", exact: true })
      .click();
    await download;
  };
  await exportSVG();
  expect(new URL(exports[0]).searchParams.has("experimental")).toBe(false);
  await enterExperiment(page);
  await expect(
    page.getByRole("button", { name: "Источник света", exact: true }),
  ).toBeVisible();
  await exportSVG();
  expect(new URL(exports[1]).searchParams.get("experimental")).toBe("true");
  await page
    .getByRole("button", { name: "Вернуться в обычный редактор", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  expect(stored).toEqual(scene);
  await page.reload();
  await expect(page.getByLabel("Название проекта")).toHaveValue(scene.title);
  await expect(
    page.getByRole("button", { name: "Источник света", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Открыть эксперимент", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Свет и тень: короткий маршрут" }),
  ).toBeVisible();
});

for (const width of [390, 320]) {
  test(`experimental guide and return action stay reachable at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page
      .context()
      .addCookies([
        {
          name: "ochen_welcome_seen",
          value: "1",
          url: "http://127.0.0.1:5178",
        },
      ]);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Открыть эксперимент", exact: true })
      .click();
    const guide = page.getByRole("dialog", {
      name: "Свет и тень: короткий маршрут",
    });
    await expect(guide).toBeVisible();
    await guide.getByRole("button", { name: "Далее", exact: true }).click();
    await expect(
      guide.getByRole("heading", { name: "Переместите солнце" }),
    ).toBeVisible();
    await guide.getByRole("button", { name: "Назад", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`guide-${width}.png`) });
    await guide
      .getByRole("button", { name: "Закрыть инструкцию", exact: true })
      .click();
    const back = page.getByRole("button", {
      name: "Вернуться в обычный редактор",
      exact: true,
    });
    await expect(back).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await back.click();
    await expect(
      page.getByRole("region", { name: "Экспериментальная мастерская" }),
    ).toHaveCount(0);
  });
}
