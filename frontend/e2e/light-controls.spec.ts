import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Scene } from "../src/types";
const catalog = JSON.parse(readFileSync("../assets/catalog.json", "utf8"));
const shadows = JSON.parse(readFileSync("../assets/shadow-map.json", "utf8"));
const base: Scene = {
  version: 1,
  title: "Свет и опоры",
  format: "landscape",
  detail: "L",
  scale: 0.25,
  palette: catalog.palettes[0],
  transparent: false,
  elements: [
    {
      id: "phone",
      family: "phone",
      role: "main",
      x: 130,
      y: 330,
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
    {
      id: "pen",
      family: "pen",
      role: "main",
      x: 410,
      y: 80,
      angle: 0,
      hidden: false,
      locked: false,
      support_ids: ["lamp"],
    },
  ],
};
async function start(page: Page, enabled = true, initial: Scene = base) {
  await page
    .context()
    .addCookies([
      { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:5178" },
    ]);
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch(),
      bootstrap = await response.json();
    await route.fulfill({
      response,
      json: {
        ...bootstrap,
        features: { custom_shadows: enabled },
        assets: bootstrap.assets.map((a: { id: string }) => ({
          ...a,
          shadow: shadows[a.id],
        })),
      },
    });
  });
  let scene = structuredClone(initial),
    revision = 1;
  await page.route("**/api/projects/light-controls", async (route) => {
    if (route.request().method() === "PUT") {
      scene = route.request().postDataJSON().scene;
      revision++;
    }
    await route.fulfill({
      json: {
        id: "light-controls",
        scene,
        revision,
        updated_at: "2026-11-10T00:00:00Z",
      },
    });
  });
  await page.goto("/?project=light-controls");
  await expect(page.getByLabel("Название проекта")).toHaveValue(initial.title);
  await expect(page.getByTestId("artboard")).toBeVisible();
  return () => scene;
}
async function dragMarker(page: Page, dx: number, dy: number, cancel = false) {
  const marker = page.getByRole("button", {
    name: "Источник света",
    exact: true,
  });
  const box = await marker.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + dx,
    box!.y + box!.height / 2 + dy,
    { steps: 5 },
  );
  if (cancel)
    await page
      .getByTestId("artboard")
      .dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
}

test("master flag hides experimental controls but preserves core receiver shadows and saved settings", async ({
  page,
}) => {
  const stored = structuredClone(base);
  stored.light = { enabled: true, x: 100, y: 100, height: 1000, opacity: 0.35 };
  const saved = await start(page, false, stored);
  await expect(
    page.getByLabel("Общий источник света", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Источник света", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  await expect(page.getByLabel("Своя тень", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Опора", { exact: true })).toHaveValue("phone");
  await expect(
    page.getByRole("button", { name: "Направление и длина тени", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("artboard").locator("[data-custom-shadow]"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("artboard").locator("[data-contact-shadow-owner]"),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  expect(saved().light).toEqual(stored.light);
  expect(saved().elements.find((e) => e.id === "lamp")!.shadow).toEqual(
    stored.elements[1].shadow,
  );
  await page.getByRole("button", { name: "Помощь", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Своя тень:", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByText("Общий свет:", { exact: true }),
  ).toHaveCount(0);
});

test("global source drags with one undo, cancels, changes density and survives reload without changing individual settings", async ({
  page,
}, testInfo) => {
  const saved = await start(page);
  await page.getByLabel("Общий источник света", { exact: true }).check();
  const marker = page.getByRole("button", {
    name: "Источник света",
    exact: true,
  });
  await expect(marker).toBeVisible();
  const initial = await marker.getAttribute("transform");
  const projected = page
    .getByTestId("artboard")
    .locator("[data-custom-shadow]")
    .first();
  const initialProjection = await projected.getAttribute("transform");
  await dragMarker(page, 30, 20, true);
  await expect(marker).toHaveAttribute("transform", initial!);
  await dragMarker(page, 40, 25);
  const moved = await marker.getAttribute("transform");
  expect(moved).not.toBe(initial);
  await expect(projected).not.toHaveAttribute("transform", initialProjection!);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(marker).toHaveAttribute("transform", initial!);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(marker).toHaveAttribute("transform", moved!);
  await marker.focus();
  await page.keyboard.press("ArrowRight");
  await expect(marker).not.toHaveAttribute("transform", moved!);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(marker).toHaveAttribute("transform", moved!);
  await page.getByLabel("Высота источника", { exact: true }).fill("1600");
  await page.getByLabel("Высота источника", { exact: true }).blur();
  await page.getByLabel("Плотность теней", { exact: true }).fill("60");
  await page.getByLabel("Плотность теней", { exact: true }).blur();
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  expect(saved().light).toMatchObject({
    enabled: true,
    height: 1600,
    opacity: 0.6,
  });
  expect(saved().elements.find((e) => e.id === "lamp")!.shadow).toEqual(
    base.elements[1].shadow,
  );
  await page.reload();
  await expect(marker).toHaveAttribute("transform", moved!);
  await expect(
    page.getByLabel("Высота источника", { exact: true }),
  ).toHaveValue("1600");
  await page.screenshot({ path: testInfo.outputPath("scene-light.png") });
});

test("manual receivers exclude cycles, preserve multiple receivers until changed and work with the experiment disabled", async ({
  page,
}) => {
  const multiple = structuredClone(base);
  multiple.elements.push({
    id: "folder",
    family: "folder",
    role: "background",
    x: 600,
    y: 350,
    angle: 0,
    hidden: false,
    locked: false,
  });
  multiple.elements.find((e) => e.id === "lamp")!.support_ids = [
    "phone",
    "folder",
  ];
  const saved = await start(page, false, multiple);
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  const support = page.getByLabel("Опора", { exact: true });
  await expect(support).toHaveValue(":multiple");
  await expect(
    support.getByRole("option", { name: "Ручка", exact: true }),
  ).toHaveCount(0);
  await support.selectOption("phone");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  expect(saved().elements.find((e) => e.id === "lamp")!.support_ids).toEqual([
    "phone",
  ]);
  await support.selectOption("");
  await expect(support).toHaveValue("");
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  await expect(support).toHaveValue("phone");
});

test("active source hides individual shadow editing and switching it off restores the saved pose", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Общий источник света", { exact: true }).check();
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  await expect(page.getByLabel("Своя тень", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Настроить свет", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Настроить свет", exact: true })
    .click();
  await page.getByLabel("Общий источник света", { exact: true }).uncheck();
  await expect(
    page.getByRole("button", { name: "Источник света", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
  await expect(
    page.getByLabel("Направление тени", { exact: true }),
  ).toHaveValue("120");
  await expect(page.getByLabel("Длина тени", { exact: true })).toHaveValue(
    "140",
  );
});

test("an active source gesture cannot bypass the unsaved-document guard", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Общий источник света", { exact: true }).check();
  const marker = page.getByRole("button", {
    name: "Источник света",
    exact: true,
  });
  const bounds = await marker.boundingBox();
  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 40, bounds!.y + 20, { steps: 4 });
  // Activating another control while capture is active must keep the current work.
  await page
    .getByRole("button", { name: "Новый проект", exact: true })
    .dispatchEvent("click");
  await expect(page.getByLabel("Название проекта")).toHaveValue(base.title);
  await expect(page.getByRole("alert")).toContainText("Сначала сохраните");
  await page
    .getByTestId("artboard")
    .dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Новый проект", exact: true }).click();
  await expect(page.getByLabel("Название проекта")).not.toHaveValue(base.title);
  await expect(marker).toHaveCount(0);
  await expect(
    page.getByLabel("Общий источник света", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
});

for (const enabled of [true, false]) {
  test(`object resize and rotation preserve the saved individual shadow with custom flag ${enabled}`, async ({
    page,
  }) => {
    const initial = structuredClone(base);
    const individual = {
      angle: 120,
      length: 1.4,
      opacity: 0.65,
      x: 23,
      y: -11,
      scale_x: 1.3,
      scale_y: 0.75,
    };
    initial.elements.find((e) => e.id === "lamp")!.shadow = individual;
    initial.light = {
      enabled: true,
      x: 150,
      y: 100,
      height: 1800,
      opacity: 0.35,
    };
    const saved = await start(page, enabled, initial);
    await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
    const drag = async (name: string, dx: number, dy: number) => {
      const handle = page.getByRole("button", { name, exact: true });
      const box = await handle.boundingBox();
      const x = box!.x + box!.width / 2,
        y = box!.y + box!.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 5 });
      await page.mouse.up();
    };
    const save = async () => {
      await page
        .getByRole("button", { name: "Сохранить проект", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
      ).toBeVisible();
      expect(saved().elements.find((e) => e.id === "lamp")!.shadow).toEqual(
        individual,
      );
    };
    const owner = page
      .getByTestId("artboard")
      .locator('[data-element-id="lamp"]');
    const originalTransform = await owner.getAttribute("transform");
    await drag("Размер объекта: e", 24, 0);
    await expect(owner).not.toHaveAttribute("transform", originalTransform!);
    await save();
    await page
      .getByRole("button", { name: "Размер объекта: e", exact: true })
      .focus();
    await page.keyboard.press("ArrowRight");
    await save();
    const resized = await owner.getAttribute("transform");
    await drag("Повернуть объект", 30, 18);
    await expect(owner).not.toHaveAttribute("transform", resized!);
    await save();
    await page
      .getByRole("button", { name: "Повернуть объект", exact: true })
      .focus();
    await page.keyboard.press("ArrowRight");
    await save();
    const transformed = await owner.getAttribute("transform");
    await page.reload();
    await expect(owner).toHaveAttribute("transform", transformed!);
    if (!enabled) {
      await page.route("**/api/bootstrap", async (route) => {
        const response = await route.fetch(),
          data = await response.json();
        await route.fulfill({
          response,
          json: {
            ...data,
            features: { custom_shadows: true },
            assets: data.assets.map((a: { id: string }) => ({
              ...a,
              shadow: shadows[a.id],
            })),
          },
        });
      });
      await page.reload();
    }
    await page.getByLabel("Общий источник света", { exact: true }).uncheck();
    await save();
    await page.getByRole("button", { name: "Слой Лампа", exact: true }).click();
    await expect(
      page.getByLabel("Направление тени", { exact: true }),
    ).toHaveValue("120");
    await expect(page.getByLabel("Длина тени", { exact: true })).toHaveValue(
      "140",
    );
    expect(saved().elements.find((e) => e.id === "lamp")!.shadow).toEqual(
      individual,
    );
  });
}

test("dragging or nudging light beyond an edge keeps its marker reachable", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Общий источник света", { exact: true }).check();
  const marker = page.getByRole("button", {
    name: "Источник света",
    exact: true,
  });
  const board = page.getByTestId("artboard");
  const limits = await board.boundingBox();
  const inCanvas = async () => {
    const center = await marker.evaluate((node) => {
      const p = new DOMPoint(0, 0).matrixTransform(
        (node as SVGGElement).getScreenCTM()!,
      );
      return { x: p.x, y: p.y };
    });
    expect(center.x).toBeGreaterThanOrEqual(limits!.x + 14);
    expect(center.x).toBeLessThanOrEqual(limits!.x + limits!.width - 14);
    expect(center.y).toBeGreaterThanOrEqual(limits!.y + 14);
    expect(center.y).toBeLessThanOrEqual(limits!.y + limits!.height - 14);
  };
  await dragMarker(page, -1000, -1000);
  await inCanvas();
  await marker.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowUp");
  await inCanvas();
  await dragMarker(page, 2000, 2000);
  await inCanvas();
});

test("an imported outside light can be returned explicitly with one undo", async ({
  page,
}) => {
  const initial = structuredClone(base);
  initial.light = {
    enabled: true,
    x: -800,
    y: 1800,
    height: 1500,
    opacity: 0.4,
  };
  const saved = await start(page, true, initial);
  const recover = page.getByRole("button", {
    name: "Вернуть источник на холст",
    exact: true,
  });
  await expect(recover).toBeVisible();
  await recover.click();
  const marker = page.getByRole("button", {
    name: "Источник света",
    exact: true,
  });
  await expect(marker).toBeInViewport();
  await expect(recover).toHaveCount(0);
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Сохранено$/ }),
  ).toBeVisible();
  expect(saved().light!.x).toBeGreaterThanOrEqual(0);
  expect(saved().light!.y).toBeLessThanOrEqual(630);
  expect(saved().light!.height).toBe(1500);
  expect(saved().light!.opacity).toBe(0.4);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(marker).toHaveAttribute("transform", "translate(-800 1800)");
  await expect(recover).toBeVisible();
});
