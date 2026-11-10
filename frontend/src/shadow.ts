import type { Element, Shadow, ShadowMetadata } from "./types";
export type ShadowEffect = {
  settings: Shadow;
  metadata: ShadowMetadata;
  role: Element["role"];
  width: number;
  height: number;
};
const NS = "http://www.w3.org/2000/svg";
export function shadowMatrix(meta: ShadowMetadata, shadow: Shadow): string {
  const angle = (shadow.angle * Math.PI) / 180,
    [x, y] = meta.anchor;
  const scaleX = shadow.length * (shadow.scale_x ?? 1),
    scaleY = shadow.length * (shadow.scale_y ?? 1),
    a = Math.cos(angle) * scaleX,
    b = Math.sin(angle) * scaleX,
    c = -Math.sin(angle) * scaleY,
    d = Math.cos(angle) * scaleY;
  return `matrix(${[a, b, c, d, x + (shadow.x ?? 0) - a * x - c * y, y + (shadow.y ?? 0) - b * x - d * y].map((n) => n.toFixed(6)).join(" ")})`;
}
export function applyCustomShadow(
  document: Document,
  effect: ShadowEffect,
): void {
  const { metadata: meta, settings, role, width, height } = effect,
    root = document.documentElement;
  const create = (tag: string, attrs: Record<string, string> = {}) => {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, value);
    return node;
  };
  const children = [...root.children];
  const paths = new Map(
    [...root.querySelectorAll("path")].map((p) => [p.id, p]),
  );
  const defs = create("defs"),
    mask = create("mask", {
      id: "custom-body-mask",
      maskUnits: "userSpaceOnUse",
      "mask-type": "luminance",
      x: String(-width * 3),
      y: String(-height * 3),
      width: String(width * 7),
      height: String(height * 7),
    });
  const matte = create("g", {
    "data-mask-part": "body",
    fill: "white",
    stroke: "white",
    "stroke-width": String(meta.outline),
    "stroke-linejoin": "round",
  });
  if (meta.hull)
    matte.append(
      create("polygon", {
        points: meta.hull.map((p) => p.join(",")).join(" "),
      }),
    );
  else {
    const sourceMatte = create("g", {
      transform: children[0].getAttribute("transform") ?? "",
    });
    for (const id of meta.body_path_ids) {
      const original = paths.get(id);
      if (!original)
        throw new Error("Разметка тени не соответствует исходнику");
      const node = original.cloneNode(true) as SVGElement;
      node.removeAttribute("id");
      node.setAttribute("fill", "white");
      node.setAttribute("stroke", "white");
      sourceMatte.append(node);
    }
    matte.append(sourceMatte);
  }
  for (const polygon of meta.keep_polygons ?? [])
    matte.append(
      create("polygon", { points: polygon.map((p) => p.join(",")).join(" ") }),
    );
  if (meta.preserve_above !== undefined)
    matte.append(
      create("rect", {
        x: "-10",
        y: "-10",
        width: String(width + 20),
        height: String(meta.preserve_above + 10),
      }),
    );
  mask.append(matte);
  defs.append(mask);
  if (meta.erase_path_ids) {
    const erase = create("g", {
      transform: children[0].getAttribute("transform") ?? "",
    });
    for (const id of meta.erase_path_ids) {
      const node = paths.get(id)!.cloneNode(true) as SVGElement;
      node.removeAttribute("id");
      node.setAttribute("fill", "black");
      node.setAttribute("stroke", "black");
      node.setAttribute("stroke-width", String(meta.outline));
      erase.append(node);
    }
    mask.append(erase);
  }
  const inverse = mask.cloneNode(true) as SVGElement;
  inverse.setAttribute("id", "custom-cast-mask");
  for (const node of [...inverse.querySelectorAll("*")]) {
    for (const key of ["fill", "stroke"]) {
      const color = node.getAttribute(key);
      if (color === "white" || color === "black")
        node.setAttribute(key, color === "white" ? "black" : "white");
    }
  }
  inverse.prepend(
    create("rect", {
      x: mask.getAttribute("x")!,
      y: mask.getAttribute("y")!,
      width: mask.getAttribute("width")!,
      height: mask.getAttribute("height")!,
      fill: "white",
    }),
  );
  defs.append(inverse);
  const cast = create("g", { mask: "url(#custom-cast-mask)" });
  const castSource = create("g", { "data-shadow-subject": "true" });
  for (const child of children) castSource.append(child.cloneNode(true));
  const castIds = new Set(meta.cast_path_ids);
  for (const node of [...castSource.querySelectorAll("path")])
    if (!castIds.has(node.id)) node.remove();
  if (meta.cast_regions) {
    const regions = create("clipPath", {
      id: "custom-cast-region",
      clipPathUnits: "userSpaceOnUse",
    });
    for (const polygon of meta.cast_regions)
      regions.append(
        create("polygon", {
          points: polygon.map((p) => p.join(",")).join(" "),
        }),
      );
    defs.append(regions);
    cast.setAttribute("clip-path", "url(#custom-cast-region)");
  }
  for (const node of [...castSource.querySelectorAll("[id]")])
    node.removeAttribute("id");
  cast.append(castSource);
  const body = create("g", {
    mask: "url(#custom-body-mask)",
  });
  const subject = create("g", { "data-shadow-subject": "true" });
  subject.append(...children);
  body.append(subject);
  if (meta.sidewall) {
    const [cx, cy, rx, ry, depth] = meta.sidewall,
      fmt = (n: number) => n.toFixed(6);
    const d = `M${fmt(cx - rx)} ${fmt(cy + depth)} A${fmt(rx)} ${fmt(ry)} 0 0 0 ${fmt(cx + rx)} ${fmt(cy + depth)} L${fmt(cx + rx)} ${fmt(cy)} A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(cx - rx)} ${fmt(cy)} Z`;
    const repair = create("g", { "data-shadow-body-repair": "true" });
    repair.append(
      create("path", {
        d,
        fill: role === "main" ? "white" : "#D7CDF5",
        stroke: role === "main" ? "#181817" : "#7864D7",
        "stroke-width": String(meta.outline / 3),
      }),
    );
    body.append(repair);
  }
  const layer = create("g", {
    "data-custom-shadow": "true",
    "data-shadow-source": "original-footprint",
    "pointer-events": "none",
    opacity: String(settings.opacity),
    transform: shadowMatrix(meta, settings),
  });
  layer.append(cast);
  if (
    settings.angle % 360 === 0 &&
    settings.length === 1 &&
    settings.opacity === 1 &&
    (settings.x ?? 0) === 0 &&
    (settings.y ?? 0) === 0 &&
    (settings.scale_x ?? 1) === 1 &&
    (settings.scale_y ?? 1) === 1
  ) {
    layer.setAttribute("display", "none");
    body.setAttribute("mask", "none");
    for (const repair of [
      ...body.querySelectorAll("[data-shadow-body-repair]"),
    ])
      repair.setAttribute("display", "none");
  }
  root.append(defs, layer, body);
}
