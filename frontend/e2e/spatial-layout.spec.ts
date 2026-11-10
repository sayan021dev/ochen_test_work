import { expect, test } from "@playwright/test";

test("literal spatial request is respected in all three selectable compositions", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:5178" },
  ]);
  await page.goto("/");
  await page.getByRole("tab", { name: "Предметы", exact: true }).click();
  await page
    .getByLabel("Описание композиции")
    .fill("пазл на монете а под ними книга");
  await page
    .getByRole("button", { name: "Собрать композицию", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Вариант композиции 1", exact: true }),
  ).toBeVisible();
  const board = page.getByTestId("artboard");
  for (let variant = 1; variant <= 3; variant++) {
    const choice = page.getByRole("button", {
      name: `Вариант композиции ${variant}`,
      exact: true,
    });
    if (variant > 1)
      await page
        .getByRole("button", {
          name: "Показать варианты композиции",
          exact: true,
        })
        .click();
    await choice.click();
    await expect(choice).toBeHidden();
    const boxes = await board
      .locator("[data-element-id]")
      .evaluateAll((nodes) =>
        Object.fromEntries(
          nodes.map((node) => {
            const b = node.getBoundingClientRect();
            return [
              (node as SVGGElement).dataset.family,
              { top: b.top, bottom: b.bottom, left: b.left, right: b.right },
            ];
          }),
        ),
      );
    expect(Object.keys(boxes).sort()).toEqual(["book", "coin", "puzzle"]);
    expect(boxes.book.top).toBeGreaterThan(
      Math.max(boxes.coin.bottom, boxes.puzzle.bottom) - 1,
    );
    expect(boxes.puzzle.top).toBeLessThan(boxes.coin.top);
    expect(boxes.puzzle.bottom).toBeGreaterThan(boxes.coin.top);
    await expect(board.locator("[data-scene-shadows]")).toHaveCount(1);
    await expect(
      board.locator("[data-element-id] [data-custom-shadow]"),
    ).toHaveCount(0);
  }
});

test("a lamp behind two separated objects generates all three variants without a false contradiction", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "ochen_welcome_seen", value: "1", url: "http://127.0.0.1:5178" },
  ]);
  await page.goto("/");
  await page.getByRole("tab", { name: "Предметы", exact: true }).click();
  await page
    .getByLabel("Описание композиции")
    .fill("лампа позади кошелька и монеты, кошелек ниже монеты");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/compose") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Собрать композицию", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  const board = page.getByTestId("artboard");
  for (let variant = 1; variant <= 3; variant++) {
    if (variant > 1)
      await page
        .getByRole("button", {
          name: "Показать варианты композиции",
          exact: true,
        })
        .click();
    await page
      .getByRole("button", {
        name: `Вариант композиции ${variant}`,
        exact: true,
      })
      .click();
    const elements = await board
      .locator("[data-element-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return {
            family: (node as SVGGElement).dataset.family!,
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            right: box.right,
          };
        }),
      );
    expect(elements.map((e) => e.family).sort()).toEqual([
      "coin",
      "lamp",
      "wallet",
    ]);
    const lamp = elements.find((e) => e.family === "lamp")!;
    const wallet = elements.find((e) => e.family === "wallet")!;
    const coin = elements.find((e) => e.family === "coin")!;
    expect(elements.indexOf(lamp)).toBeLessThan(elements.indexOf(wallet));
    expect(elements.indexOf(lamp)).toBeLessThan(elements.indexOf(coin));
    expect(wallet.top).toBeGreaterThanOrEqual(coin.bottom - 1);
    for (const target of [wallet, coin]) {
      expect(Math.min(lamp.right, target.right)).toBeGreaterThan(
        Math.max(lamp.left, target.left),
      );
      expect(Math.min(lamp.bottom, target.bottom)).toBeGreaterThan(
        Math.max(lamp.top, target.top),
      );
    }
  }
});
