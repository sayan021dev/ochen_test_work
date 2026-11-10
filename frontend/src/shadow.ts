import type { Element, Shadow, ShadowMetadata } from "./types";
export type ShadowEffect = {
  settings: Shadow;
  metadata: ShadowMetadata;
  role: Element["role"];
  width: number;
  height: number;
  separateLayers?: boolean;
  preserveSource?: boolean;
  receiverOnlyBody?: boolean;
};
const NS = "http://www.w3.org/2000/svg";
function projectionValues(meta: ShadowMetadata, shadow: Shadow): number[] {
  const projection = meta.projection ?? {
    ground: [
      meta.anchor[0] - meta.width / 2,
      meta.anchor[1],
      meta.anchor[0] + meta.width / 2,
      meta.anchor[1],
    ],
    depth: meta.height * 0.65,
    body_bbox: [
      meta.anchor[0] - meta.width / 2,
      meta.anchor[1] - meta.height,
      meta.width,
      meta.height,
    ],
  };
  const [x, y, endX, endY] = projection.ground,
    span = Math.hypot(endX - x, endY - y);
  const [tx, ty] =
    span > 1e-9 ? [(endX - x) / span, (endY - y) / span] : [1, 0];
  const [nx, ny] = [ty, -tx],
    height = Math.max(projection.body_bbox[3], 1e-9);
  const angle = (shadow.angle * Math.PI) / 180,
    depth = projection.depth * shadow.length;
  const vx = (Math.cos(angle) * depth + (shadow.x ?? 0)) / height;
  const vy = (Math.sin(angle) * depth + (shadow.y ?? 0)) / height;
  const [a, b, c, d] = [
    tx * tx + vx * nx,
    ty * tx + vy * nx,
    tx * ty + vx * ny,
    ty * ty + vy * ny,
  ];
  return [a, b, c, d, x - a * x - c * y, y - b * x - d * y];
}
export function shadowMatrix(meta: ShadowMetadata, shadow: Shadow): string {
  return `matrix(${projectionValues(meta, shadow)
    .map((n) => n.toFixed(6))
    .join(" ")})`;
}

export function applyCustomShadow(
  document: Document,
  effect: ShadowEffect,
): void {
  const { metadata: meta, settings, role, width, height } = effect,
    root = document.documentElement;
  const preserveSource = effect.preserveSource ?? false;
  const blackCopy = (node: SVGElement, color: string) => {
    const copy = node.cloneNode(true) as SVGElement;
    for (const child of [copy, ...copy.querySelectorAll("*")]) {
      child.removeAttribute("id");
      child.removeAttribute("data-shadow-body");
      for (const key of ["fill", "stroke"])
        if (child.hasAttribute(key) && child.getAttribute(key) !== "none")
          child.setAttribute(key, color);
    }
    return copy;
  };
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
  const sourceSubtraction =
    preserveSource &&
    (!effect.receiverOnlyBody ||
      (!!meta.cast_regions && meta.preserve_above !== undefined));
  const body = create("g", { "data-shadow-body": "true" });
  const subject = create("g", {
    "data-shadow-subject": "true",
    mask: sourceSubtraction
      ? "url(#custom-source-body-mask)"
      : "url(#custom-body-mask)",
  });
  subject.append(...children);
  body.append(subject);
  if (!preserveSource) {
    const excluded = new Set(meta.body_exclude_path_ids ?? []);
    for (const path of [...subject.querySelectorAll("path")])
      if (excluded.has(path.id)) path.remove();
  }
  if (sourceSubtraction) {
    const sourceMask = create("mask", {
      id: "custom-source-body-mask",
      maskUnits: "userSpaceOnUse",
      "mask-type": "luminance",
      "data-source-body-mask": "true",
    });
    const rectAttrs: Record<string, string> = {
      fill: "white",
      "data-mask-allow": "true",
    };
    for (const key of ["x", "y", "width", "height"]) {
      sourceMask.setAttribute(key, mask.getAttribute(key)!);
      rectAttrs[key] = mask.getAttribute(key)!;
    }
    sourceMask.append(create("rect", rectAttrs));
    const subtraction = blackCopy(cast, "black");
    subtraction.setAttribute("data-mask-cut", "true");
    if (effect.receiverOnlyBody)
      for (const path of subtraction.querySelectorAll("path")) {
        path.setAttribute("stroke", "black");
        path.setAttribute("stroke-width", String(meta.outline));
      }
    sourceMask.append(subtraction);
    defs.append(sourceMask);
  }
  if (meta.sidewall && !preserveSource) {
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
    "data-shadow-source": preserveSource
      ? "original-footprint"
      : "body-silhouette",
    "pointer-events": "none",
    opacity: String(settings.opacity),
    transform: preserveSource
      ? "matrix(1.000000 0.000000 -0.000000 1.000000 0.000000 0.000000)"
      : shadowMatrix(meta, settings),
  });
  if (preserveSource) layer.append(cast);
  else {
    const silhouette = blackCopy(body, "#181817");
    silhouette.setAttribute("data-shadow-subject", "true");
    layer.append(silhouette);
    const [a, b, c, d, e, f] = shadowMatrix(meta, settings)
        .slice(7, -1)
        .split(" ")
        .map(Number),
      determinant = a * d - b * c;
    const raw = projectionValues(meta, settings);
    if (
      Math.abs(raw[0] * raw[3] - raw[1] * raw[2]) <= 1e-12 ||
      Math.abs(determinant) <= 1e-12
    )
      layer.setAttribute("display", "none");
    else {
      const inverse = [
        d / determinant,
        -b / determinant,
        -c / determinant,
        a / determinant,
        (c * f - d * e) / determinant,
        (b * e - a * f) / determinant,
      ];
      const [ia, ib, ic, id, ie, iff] = inverse;
      const corners = [
          [0, 0],
          [width, 0],
          [0, height],
          [width, height],
        ],
        covered = [
          ...corners,
          ...corners.map(([x, y]) => [
            ia * x + ic * y + ie,
            ib * x + id * y + iff,
          ]),
        ];
      const margin = Math.max(meta.outline, 1) * 3,
        left = Math.min(...covered.map((p) => p[0])) - margin,
        top = Math.min(...covered.map((p) => p[1])) - margin;
      const bounds = {
        x: String(left),
        y: String(top),
        width: String(Math.max(...covered.map((p) => p[0])) - left + margin),
        height: String(Math.max(...covered.map((p) => p[1])) - top + margin),
      };
      const occlusion = create("mask", {
        ...bounds,
        id: "custom-projection-occlusion",
        maskUnits: "userSpaceOnUse",
        "mask-type": "luminance",
      });
      occlusion.append(create("rect", { ...bounds, fill: "white" }));
      const fixed = create("g", {
        "data-shadow-occluder": "true",
        transform: `matrix(${inverse.map((n) => n.toFixed(9)).join(" ")})`,
      });
      const opaqueBody = blackCopy(body, "black");
      opaqueBody.setAttribute("data-shadow-occluder-body", "true");
      fixed.append(opaqueBody);
      occlusion.append(fixed);
      defs.append(occlusion);
      layer.setAttribute("mask", "url(#custom-projection-occlusion)");
    }
  }
  root.append(defs, layer, body);
}
