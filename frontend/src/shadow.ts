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
  const length = Math.max(meta.width, meta.height) * 0.65 * shadow.length;
  const a = -Math.sin(angle) * 0.45,
    b = Math.cos(angle) * 0.45,
    c = (-Math.cos(angle) * length) / meta.height,
    d = (-Math.sin(angle) * length) / meta.height;
  return `matrix(${[a, b, c, d, x - a * x - c * y, y - b * x - d * y].map((n) => n.toFixed(6)).join(" ")})`;
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
      x: String(-width * 3),
      y: String(-height * 3),
      width: String(width * 7),
      height: String(height * 7),
    });
  const matte = create("g", {
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
  const cast = body.cloneNode(true) as SVGElement;
  for (const node of [cast, ...cast.querySelectorAll("*")]) {
    node.removeAttribute("id");
    if (node.localName === "path") {
      node.setAttribute("fill", role === "main" ? "#181817" : "#7864D7");
      if (node.hasAttribute("stroke"))
        node.setAttribute("stroke", role === "main" ? "#181817" : "#7864D7");
    }
  }
  const layer = create("g", {
    "data-custom-shadow": "true",
    "pointer-events": "none",
    opacity: String(settings.opacity),
    transform: shadowMatrix(meta, settings),
  });
  layer.append(cast);
  root.append(defs, layer, body);
}
