import { expect, type Page } from "@playwright/test";

/** Experiments require an explicit UI entry after every reload. */
export async function enterExperiment(page: Page) {
  await page
    .getByRole("button", { name: "Открыть эксперимент", exact: true })
    .click();
  const guide = page.getByRole("dialog", {
    name: "Свет и тень: короткий маршрут",
  });
  await expect(guide).toBeVisible();
  await guide
    .getByRole("button", { name: "Закрыть инструкцию", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Экспериментальная мастерская" }),
  ).toBeVisible();
}
