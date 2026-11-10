import type { Palette, PaintRole } from "./types";
import { applyCustomShadow, type ShadowEffect } from "./shadow";

const original = {
  background: ["#D7CDF5", "#AA9BF0", "#7864D7", "#181817"],
  object: ["#F9ECB0", "#F9A3AA", "#FFE3E1", "#FFFFFF"],
};

export function prepareAsset(
  source: string,
  palette: Palette,
  prefix: string,
  effect?: ShadowEffect,
  colorMap: Partial<Record<PaintRole, PaintRole>> = {},
): string {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (effect) applyCustomShadow(document, effect);
  const ids = new Map<string, string>();
  document
    .querySelectorAll("[id]")
    .forEach((e, i) => ids.set(e.id, `i_${prefix}_${i}`));
  document.querySelectorAll("*").forEach((element) => {
    const localID = (id: string) => {
      const value = ids.get(id);
      if (!value) throw new Error("Неизвестная ссылка SVG");
      return value;
    };
    for (const attribute of [...element.attributes]) {
      const { name, value } = attribute;
      if (name === "id") element.setAttribute(name, ids.get(value)!);
      else if (name === "href" || name === "xlink:href")
        element.setAttributeNS(
          attribute.namespaceURI,
          name,
          `#${localID(value.slice(1))}`,
        );
      else if (value.includes("url("))
        element.setAttribute(
          name,
          value.replace(
            /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g,
            (_, id) => `url(#${localID(id)})`,
          ),
        );
      else if (
        ["fill", "stroke", "stop-color"].includes(name) &&
        !element.closest("mask,clipPath")
      ) {
        const normalized =
          value.toLowerCase() === "white" ? "#FFFFFF" : value.toUpperCase();
        for (const role of ["background", "object"] as const) {
          const index = original[role].indexOf(normalized);
          if (index >= 0) {
            const sourceRole = `${role}-${index}` as PaintRole;
            const targetRole = colorMap[sourceRole] ?? sourceRole;
            const [group, slot] = targetRole.split("-") as [
              "background" | "object",
              string,
            ];
            element.setAttribute(name, palette[group][Number(slot)]);
          }
        }
      }
    }
  });
  return [...document.documentElement.children]
    .map((e) => new XMLSerializer().serializeToString(e))
    .join("");
}

export function prepareAssetLayer(
  source: string,
  palette: Palette,
  prefix: string,
  effect: ShadowEffect,
  layer: "body" | "shadow",
  custom = true,
  colorMap: Partial<Record<PaintRole, PaintRole>> = {},
): string {
  const markup = prepareAsset(
    source,
    palette,
    prefix,
    {
      ...effect,
      separateLayers: true,
      preserveSource: !custom,
    },
    colorMap,
  );
  const root = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    "image/svg+xml",
  ).documentElement;
  if (!custom) {
    const cast = root.querySelector("[data-custom-shadow]");
    cast?.removeAttribute("data-custom-shadow");
    cast?.setAttribute("data-source-shadow", "true");
  }
  return [...root.children]
    .filter(
      (node) =>
        node.localName === "defs" ||
        (layer === "shadow" && node.hasAttribute("data-source-shadow")) ||
        node.hasAttribute(
          layer === "body" ? "data-shadow-body" : "data-custom-shadow",
        ),
    )
    .map((node) => new XMLSerializer().serializeToString(node))
    .join("");
}
