import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Сложено" })).toBeVisible();
  await expect(page.getByTestId("artboard")).toBeVisible();
});

test("component composition, move, duplicate, layers, undo and vector export", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Предметы", exact: true }).click();
  await page.getByLabel("Описание композиции").fill("книга, лампа, монета");
  await page
    .getByRole("button", { name: "Собрать композицию", exact: true })
    .click();
  await expect(
    page.getByText("Подобраны названные предметы из исходной библиотеки."),
  ).toBeVisible();
  await expect(
    page.getByTestId("artboard").locator("[data-element-id]"),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "Слой Книга", exact: true }).click();
  await page.getByLabel("Положение X").fill("123");
  await page.getByLabel("Положение X").blur();
  await page.getByLabel("Угол поворота").fill("15");
  await page.getByLabel("Угол поворота").blur();
  await expect(
    page.getByTestId("artboard").locator('[data-family="book"]'),
  ).toHaveAttribute("transform", /translate\(123 .*rotate\(15\)/);
  await page.getByRole("button", { name: "Дублировать объект" }).click();
  await expect(
    page.getByTestId("artboard").locator("[data-element-id]"),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(
    page.getByTestId("artboard").locator("[data-element-id]"),
  ).toHaveCount(3);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать SVG", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
  const stream = await download.createReadStream();
  let svg = "";
  for await (const chunk of stream!) svg += chunk;
  expect(svg).toContain("data-source-node");
  expect(svg).toContain("<path");
  expect(svg).not.toMatch(/<image|foreignObject|https:\/\//);
});

test("palette, true detail, format and save survive page reload", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Палитра Персик" }).click();
  await expect(
    page.getByTestId("artboard").locator("[data-background]"),
  ).toHaveAttribute("fill", "#FDD7B9");
  await page.getByRole("button", { name: "Детализация S" }).click();
  await page.getByRole("button", { name: "Постер 2:3" }).click();
  await expect(page.getByTestId("artboard")).toHaveAttribute(
    "viewBox",
    "0 0 800 1200",
  );
  await expect(
    page.getByTestId("artboard").locator('[data-family="book"]'),
  ).toHaveAttribute("data-source-node", "24:3810");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Сохранено" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("artboard")).toHaveAttribute(
    "viewBox",
    "0 0 800 1200",
  );
  await expect(
    page.getByTestId("artboard").locator("[data-background]"),
  ).toHaveAttribute("fill", "#FDD7B9");
});

test("unknown components and provider errors keep the current scene", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Предметы", exact: true }).click();
  const before = await page
    .getByTestId("artboard")
    .locator("[data-element-id]")
    .count();
  await page.getByLabel("Описание композиции").fill("лампа, дракон");
  await page
    .getByRole("button", { name: "Собрать композицию", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("дракон");
  await expect(
    page.getByTestId("artboard").locator("[data-element-id]"),
  ).toHaveCount(before);
  await page.route("**/api/compose", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ detail: "OpenAI временно недоступен" }),
    }),
  );
  await page.getByRole("tab", { name: "Идея", exact: true }).click();
  await page.getByLabel("Описание композиции").fill("Учёба без отвлечений");
  await page
    .getByRole("button", { name: "Собрать композицию", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("OpenAI");
  await expect(
    page.getByTestId("artboard").locator("[data-element-id]"),
  ).toHaveCount(before);
});

test("offline metaphor, palette import, keyboard and responsive layout", async ({
  page,
}) => {
  await page.getByLabel("Использовать OpenAI").uncheck();
  await page.getByLabel("Описание композиции").fill("Собрать знания в систему");
  await page
    .getByRole("button", { name: "Собрать композицию", exact: true })
    .click();
  await expect(
    page.getByText("Словарный подбор", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Импорт палитры").setInputFiles({
    name: "custom.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        id: "test",
        name: "Тестовая",
        background: ["#123456", "#234567", "#345678", "#456789"],
        object: ["#ABCDEF", "#BCDEFA", "#CDEFAB", "#FFFFFF"],
      }),
    ),
  });
  await expect(
    page.getByTestId("artboard").locator("[data-background]"),
  ).toHaveAttribute("fill", "#123456");
  await page.getByRole("button", { name: "Слой Книга", exact: true }).click();
  await page.getByTestId("artboard").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  await expect(
    page.getByTestId("artboard").locator('[data-family="book"]'),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByTestId("artboard")).toBeVisible();
});

test("opening another saved project updates the URL and restores the chosen project", async ({
  page,
}) => {
  await page.getByLabel("Название проекта").fill("Первый проект");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Сохранено" }),
  ).toBeVisible();
  const firstURL = page.url();
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill("Второй проект");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Сохранено" }),
  ).toBeVisible();
  expect(page.url()).not.toBe(firstURL);
  await page.getByRole("button", { name: "Мои работы" }).click();
  await page.getByRole("button", { name: /Первый проект/ }).click();
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Первый проект",
  );
  await expect(page).toHaveURL(firstURL);
  await page.reload();
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Первый проект",
  );
});

test("pointer drag is one undo step at the current canvas scale", async ({
  page,
}) => {
  const object = page.getByTestId("artboard").locator('[data-family="lamp"]');
  const before = await object.getAttribute("transform");
  const hit = await object.evaluate((element) => {
    const box = element.getBoundingClientRect();
    for (let row = 1; row < 10; row++)
      for (let col = 1; col < 10; col++) {
        const x = box.x + (box.width * col) / 10,
          y = box.y + (box.height * row) / 10;
        if (
          document.elementFromPoint(x, y)?.closest("[data-element-id]") ===
          element
        )
          return { x, y };
      }
    throw new Error("No painted point on the visible subject");
  });
  await page.mouse.move(hit.x, hit.y);
  await page.mouse.down();
  await page.mouse.move(hit.x + 45, hit.y + 25, { steps: 5 });
  await page.mouse.up();
  await expect(object).not.toHaveAttribute("transform", before!);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(object).toHaveAttribute("transform", before!);
});

test("concurrent edits cause a recoverable conflict instead of overwriting another tab", async ({
  page,
  context,
}) => {
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Сохранено" }),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(
    second.getByRole("status").filter({ hasText: "Сохранено" }),
  ).toBeVisible();
  await page.getByLabel("Название проекта").fill("Из первой вкладки");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Сохранено" }),
  ).toBeVisible();
  await second.getByLabel("Название проекта").fill("Из второй вкладки");
  await second
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(second.getByRole("alert")).toContainText("другой вкладке");
  await expect(second.getByLabel("Название проекта")).toHaveValue(
    "Из второй вкладки",
  );
  await second
    .getByRole("button", { name: "Сохранить копию", exact: true })
    .click();
  await expect(
    second.getByRole("status").filter({ hasText: "Сохранено" }),
  ).toBeVisible();
  expect(second.url()).not.toBe(page.url());
  await second.close();
});
