import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, context }) => {
  await context.addCookies([
    { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:5178" },
  ]);
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
    page.getByRole("button", { name: "Вариант композиции 1" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("artboard").locator("[data-element-id]"),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "Слой Книга", exact: true }).click();
  await page.getByLabel("Положение X").fill("123");
  await page.getByLabel("Положение X").blur();
  await page.getByLabel("Угол поворота", { exact: true }).fill("15");
  await page.getByLabel("Угол поворота", { exact: true }).blur();
  await expect(
    page.getByTestId("artboard").locator('[data-family="book"]'),
  ).toHaveAttribute("transform", /rotate\(15\)/);
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
  await page
    .getByRole("menuitem", { name: "Скачать SVG", exact: true })
    .click();
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
  await page.getByLabel("Размер холста").selectOption("portrait");
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
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
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
    page.getByRole("button", { name: "Вариант композиции 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Загрузить палитру" }).click();
  await page.getByRole("tab", { name: "Импорт JSON" }).click();
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
  await page.getByRole("button", { name: "Применить палитру" }).click();
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
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  const firstURL = page.url();
  await page.getByRole("button", { name: "Новый проект" }).click();
  await page.getByLabel("Название проекта").fill("Второй проект");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  expect(page.url()).not.toBe(firstURL);
  await page.getByRole("button", { name: "Мои работы" }).click();
  await page
    .getByRole("button", { name: /Открыть проект «Первый проект/ })
    .click();
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
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(
    second.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  await page.getByLabel("Название проекта").fill("Из первой вкладки");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
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
    second.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  expect(second.url()).not.toBe(page.url());
  await second.close();
});

test("late generation preserves edits and repeated keyboard submission makes one request", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/api/compose", async (route) => {
    calls++;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("tab", { name: "Предметы", exact: true }).click();
  await page.getByLabel("Описание композиции").fill("книга, лампа");
  await page.getByLabel("Описание композиции").press("Control+Enter");
  await expect.poll(() => calls).toBe(1);
  await page.getByLabel("Описание композиции").press("Control+Enter");
  await page.getByLabel("Название проекта").fill("Моя новая правка");
  release();
  await expect(
    page.getByRole("button", { name: "Собрать композицию", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Моя новая правка",
  );
  expect(calls).toBe(1);
});

test("delayed initial restore cannot replace edits made while it loads", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  let release!: () => void;
  let received!: () => void;
  const started = new Promise<void>((resolve) => {
    received = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/projects/*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  await page.reload();
  await started;
  await page.getByLabel("Название проекта").fill("Правка до восстановления");
  release();
  await expect(page.getByRole("alert")).toContainText("изменилась");
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Правка до восстановления",
  );
});

test("cancelled palette validation cannot overwrite later editor changes", async ({
  page,
}) => {
  let release!: () => void, received!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      received = resolve;
    });
  await page.route("**/api/validate", async (route) => {
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Загрузить палитру" }).click();
  await page.getByRole("tab", { name: "Импорт JSON" }).click();
  await page.getByLabel("Импорт палитры").setInputFiles({
    name: "custom.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        id: "lilac",
        name: "Своя",
        background: ["#123456", "#234567", "#345678", "#456789"],
        object: ["#ABCDEF", "#BCDEFA", "#CDEFAB", "#FFFFFF"],
      }),
    ),
  });
  await page.getByRole("button", { name: "Применить палитру" }).click();
  await started;
  await page.keyboard.press("Escape");
  await page.getByLabel("Название проекта").fill("Не потерять название");
  release();
  await expect(
    page.getByTestId("artboard").locator("[data-background]"),
  ).toHaveAttribute("fill", "#D7CDF5");
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Не потерять название",
  );
  await expect(
    page.getByRole("button", { name: "Палитра Сирень" }),
  ).toBeVisible();
});

test("JSON import creates a dirty new project, autosaves it, and restores it by its own URL", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  const oldURL = page.url();
  const id = new URL(oldURL).searchParams.get("project");
  const existing = await (await page.request.get(`/api/projects/${id}`)).json();
  existing.scene.title = "Импортированный проект";
  await page.getByLabel("Импорт проекта").setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(existing.scene)),
  });
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Импортированный проект",
  );
  await expect(page).not.toHaveURL(oldURL);
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("project")).not.toBe(id);
  await page.reload();
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Импортированный проект",
  );
});

test("a save conflict blocks gallery navigation and JSON replacement until a copy is saved", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  await page.route("**/api/projects/*", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Проект изменён в другой вкладке" }),
        })
      : route.continue(),
  );
  await page.getByLabel("Название проекта").fill("Несохранённые правки");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("другой вкладке");
  await page.getByRole("button", { name: "Мои работы" }).click();
  await page
    .getByRole("button", { name: /Тихое место для больших идей/ })
    .click();
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Несохранённые правки",
  );
  await expect(page.getByRole("alert")).toContainText("Сначала сохраните");
});

test("custom shadow is a separate opt-in feature with history, persistence and vector export", async ({
  page,
}) => {
  const art = page.getByTestId("artboard");
  const original = await art.locator('[data-family="lamp"]').innerHTML();
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  await page.getByLabel("Своя тень").check();
  await expect(art.locator("[data-custom-shadow]")).toHaveCount(1);
  await page.getByLabel("Направление тени").fill("140");
  await page.getByLabel("Направление тени").blur();
  await page.getByLabel("Длина тени").fill("150");
  await page.getByLabel("Длина тени").blur();
  await page.getByLabel("Непрозрачность тени").fill("60");
  await page.getByLabel("Непрозрачность тени").blur();
  await expect(art.locator("[data-custom-shadow]")).toHaveAttribute(
    "opacity",
    "0.6",
  );
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(art.locator("[data-custom-shadow]")).toHaveAttribute(
    "opacity",
    "1",
  );
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  await page.reload();
  await expect(art.locator("[data-custom-shadow]")).toHaveCount(1);
  await page.getByRole("button", { name: "Детализация S" }).click();
  await expect(art.locator("[data-custom-shadow]")).toHaveCount(1);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать SVG", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Скачать SVG", exact: true })
    .click();
  const stream = await (await pending).createReadStream();
  let svg = "";
  for await (const chunk of stream!) svg += chunk;
  expect(svg).toContain("data-custom-shadow");
  expect(svg).toContain("<mask");
  expect(svg).not.toMatch(/<image|<filter/);
  await page.getByRole("button", { name: "Детализация L" }).click();
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  await page.getByLabel("Своя тень").uncheck();
  await expect(art.locator("[data-custom-shadow]")).toHaveCount(0);
  expect(await art.locator('[data-family="lamp"]').innerHTML()).toBe(original);
});

test("selection handles resize and floating actions and clipboard work", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  await expect(page.locator('[data-resize-handle="se"]')).toBeVisible({
    timeout: 1000,
  });
  const art = page.getByTestId("artboard"),
    object = art.locator('[data-family="lamp"]');
  const before = await object.getAttribute("transform");
  const box = await page.locator('[data-resize-handle="se"]').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 50, box!.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(object).not.toHaveAttribute("transform", before!);
  await art.focus();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(art.locator('[data-family="lamp"]')).toHaveCount(2);
  await expect(
    page.getByRole("toolbar", { name: "Действия с объектом" }),
  ).toBeVisible();
});

test("viewport is fixed, size presets center composition, and fullscreen really toggles", async ({
  page,
}) => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1,
    ),
  ).toBe(true);
  await page.getByLabel("Размер холста").selectOption("portrait");
  const art = page.getByTestId("artboard");
  await expect(art).toHaveAttribute("viewBox", "0 0 800 1200");
  const center = await art.evaluate((svg) => {
    const groups = [...svg.querySelectorAll<SVGGElement>("[data-element-id]")];
    const points = groups.flatMap((g) => {
      const b = g.getBBox(),
        m = g.transform.baseVal.consolidate()!.matrix;
      return [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    });
    return {
      x:
        (Math.min(...points.map((p) => p.x)) +
          Math.max(...points.map((p) => p.x))) /
        2,
      y:
        (Math.min(...points.map((p) => p.y)) +
          Math.max(...points.map((p) => p.y))) /
        2,
    };
  });
  expect(center.x).toBeCloseTo(400, 0);
  expect(center.y).toBeCloseTo(600, 0);
  await page.getByLabel("Размер холста").selectOption("fullhd");
  await expect(art).toHaveAttribute("viewBox", "0 0 1920 1080");
  await page.getByRole("button", { name: "Полный экран", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page.getByRole("button", { name: "Выйти из полного экрана" }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
});
test("palette can be created interactively and projects have real SVG previews", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Загрузить палитру" }).click();
  await expect(page.getByRole("dialog", { name: /палитр/i })).toBeVisible();
  await page.getByLabel("HEX фона 1").fill("#123456");
  await page.getByRole("button", { name: "Применить палитру" }).click();
  await expect(
    page.getByTestId("artboard").locator("[data-background]"),
  ).toHaveAttribute("fill", "#123456");
  await page.getByLabel("Название проекта").fill("Галерея с превью");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Мои работы" }).click();
  await expect(
    page.getByRole("heading", { name: "Мои проекты" }),
  ).toBeVisible();
  const card = page.getByRole("button", {
    name: "Открыть проект «Галерея с превью»",
  });
  await expect(card.locator("svg path").first()).toBeVisible();
  await card.click();
  await expect(page.getByLabel("Название проекта")).toHaveValue(
    "Галерея с превью",
  );
});
test("welcome is delayed, readable, and shown only once per cookie", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: /У каждой идеи/ }),
  ).not.toBeVisible();
  await expect(page.getByRole("dialog", { name: /У каждой идеи/ })).toBeVisible(
    { timeout: 6000 },
  );
  await page.getByRole("button", { name: "Начать создавать" }).click();
  await page.reload();
  await page.waitForTimeout(3700);
  await expect(
    page.getByRole("dialog", { name: /У каждой идеи/ }),
  ).not.toBeVisible();
});

test("rotation handle changes angle around the object center and is one undo step", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  const item = page.getByTestId("artboard").locator('[data-family="lamp"]'),
    before = await item.getAttribute("transform");
  const handle = page.getByRole("button", {
      name: "Повернуть объект",
      exact: true,
    }),
    box = await handle.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 70, box!.y + 35, { steps: 6 });
  await page.mouse.up();
  await expect(item).not.toHaveAttribute("transform", before!);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(item).toHaveAttribute("transform", before!);
});
