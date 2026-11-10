import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { prepareAsset } from "./svg";

const source = readFileSync(
  resolve(process.cwd(), "../assets/library/l-main-lamp.svg"),
  "utf8",
);
const palette = {
  id: "custom",
  name: "Custom",
  background: ["#111111", "#222222", "#333333", "#444444"],
  object: ["#555555", "#666666", "#777777", "#888888"],
};

it("preview preserves source geometry, resolves local IDs and colors from original roles", () => {
  const a = prepareAsset(source, palette, "a");
  const b = prepareAsset(source, palette, "b");
  const parse = (svg: string) =>
    new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
      "image/svg+xml",
    );
  const original = new DOMParser().parseFromString(source, "image/svg+xml");
  const one = parse(a),
    two = parse(b);
  expect(
    [...one.querySelectorAll("path")].map((p) => p.getAttribute("d")),
  ).toEqual(
    [...original.querySelectorAll("path")].map((p) => p.getAttribute("d")),
  );
  expect(one.querySelector('path[fill="#555555"]')).not.toBeNull();
  const ids = new Set([...one.querySelectorAll("[id]")].map((e) => e.id));
  expect([...two.querySelectorAll("[id]")].every((e) => !ids.has(e.id))).toBe(
    true,
  );
  expect(prepareAsset(source, palette, "a")).toBe(a);
});
