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

it("namespaces quoted URLs, masks, clips and href independently without recoloring mask alpha", () => {
  const fixture = readFileSync(
    resolve(process.cwd(), "../backend/tests/fixtures/references.svg"),
    "utf8",
  );
  const parse = (prefix: string) =>
    new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${prepareAsset(fixture, palette, prefix)}</svg>`,
      "image/svg+xml",
    );
  const one = parse("one"),
    two = parse("two");
  const ids = new Set([...one.querySelectorAll("[id]")].map((e) => e.id));
  expect([...two.querySelectorAll("[id]")].every((e) => !ids.has(e.id))).toBe(
    true,
  );
  for (const node of one.querySelectorAll("*"))
    for (const attribute of [...node.attributes]) {
      if (attribute.localName === "href")
        expect(ids.has(attribute.value.slice(1))).toBe(true);
      for (const match of attribute.value.matchAll(
        /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g,
      ))
        expect(ids.has(match[1])).toBe(true);
    }
  expect(one.querySelector("mask rect")?.getAttribute("fill")).toBe("white");
  expect(one.querySelector("stop")?.getAttribute("stop-color")).toBe("#555555");
});
