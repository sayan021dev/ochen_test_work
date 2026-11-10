import type { Palette } from "./types";

const original = {
  background: ["#D7CDF5", "#AA9BF0", "#7864D7", "#181817"],
  object: ["#F9ECB0", "#F9A3AA", "#FFE3E1", "#FFFFFF"],
};

export function prepareAsset(
  source: string,
  palette: Palette,
  prefix: string,
): string {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
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
          if (index >= 0) element.setAttribute(name, palette[role][index]);
        }
      }
    }
  });
  return [...document.documentElement.children]
    .map((e) => new XMLSerializer().serializeToString(e))
    .join("");
}
