import { expect, test } from "@playwright/test";
test("password page protects catalogue and generation and permits the editor after login", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:8019" },
  ]);
  await page.goto("http://127.0.0.1:8019");
  await expect(page.getByLabel("Пароль доступа")).toBeVisible();
  const brand = page.getByRole("link", { name: "Сложено, главная" });
  await expect(brand).toBeVisible();
  await expect(brand.locator(".brand-mark i")).toHaveCount(3);
  const loginBrand = await brand.innerHTML();
  expect(
    (await page.request.get("http://127.0.0.1:8019/api/bootstrap")).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post("http://127.0.0.1:8019/api/compose", {
        data: { prompt: "книга" },
      })
    ).status(),
  ).toBe(401);
  await page.getByLabel("Пароль доступа").fill("wrong-test-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Неверный пароль");
  await page.getByLabel("Пароль доступа").fill("test-access-only");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByTestId("artboard")).toBeVisible();
  expect(await brand.innerHTML()).toBe(loginBrand);
  expect(
    (await page.request.get("http://127.0.0.1:8019/api/bootstrap")).status(),
  ).toBe(200);
  await page.reload();
  await expect(page.getByTestId("artboard")).toBeVisible();
});
test("expired access can be renewed without losing unsaved editor changes", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:8019" },
  ]);
  await page.goto("http://127.0.0.1:8019");
  await page.getByLabel("Пароль доступа").fill("test-access-only");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByTestId("artboard")).toBeVisible();
  await page.getByLabel("Название проекта").fill("Сохранить после входа");
  await page.getByRole("button", { name: "Полный экран", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  const cookies = await context.cookies();
  await context.clearCookies();
  await context.addCookies(
    cookies.filter((c) => c.name !== "illustration_auth"),
  );
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(page.getByLabel("Пароль доступа")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await page.getByLabel("Пароль доступа").fill("test-access-only");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Сохранить после входа",
  );
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Сохранено");
  const previousURL = page.url();
  await context.clearCookies();
  await page.getByLabel("Название проекта").fill("Копия после новой сессии");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(page.getByLabel("Пароль доступа")).toBeVisible();
  await page.getByLabel("Пароль доступа").fill("test-access-only");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Копия после новой сессии",
  );
  await expect(page.getByRole("status")).toHaveText("Сохранено");
  expect(page.url()).not.toBe(previousURL);
});
