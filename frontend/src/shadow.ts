import type { Element, Shadow, ShadowMetadata } from "./types";
export type ShadowEffect = {
  settings: Shadow;
  metadata: ShadowMetadata;
  role: Element["role"];
  width: number;
  height: number;
  separateLayers?: boolean;
  preserveSource?: boolean;
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
  const identity =
    settings.angle % 360 === 0 &&
    settings.length === 1 &&
    settings.opacity === 1 &&
    (settings.x ?? 0) === 0 &&
    (settings.y ?? 0) === 0 &&
    (settings.scale_x ?? 1) === 1 &&
    (settings.scale_y ?? 1) === 1;
  const preserveSource =
    effect.preserveSource || (effect.separateLayers && identity);
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
    "data-shadow-body": "true",
  });
  const subject = create("g", { "data-shadow-subject": "true" });
  subject.append(...children);
  body.append(subject);
  if (preserveSource) {
    const sourceMask = create("mask", {
      id: "custom-source-body-mask",
      maskUnits: "userSpaceOnUse",
      "mask-type": "luminance",
    });
    const rectAttrs: Record<string, string> = { fill: "white" };
    for (const key of ["x", "y", "width", "height"]) {
      sourceMask.setAttribute(key, mask.getAttribute(key)!);
      rectAttrs[key] = mask.getAttribute(key)!;
    }
    sourceMask.append(create("rect", rectAttrs));
    const subtraction = cast.cloneNode(true) as SVGElement;
    for (const path of [...subtraction.querySelectorAll("path")]) {
      path.setAttribute("fill", "black");
      if (path.hasAttribute("stroke") && path.getAttribute("stroke") !== "none")
        path.setAttribute("stroke", "black");
    }
    sourceMask.append(subtraction);
    defs.append(sourceMask);
    body.setAttribute("mask", "url(#custom-source-body-mask)");
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
    "data-shadow-source": "original-footprint",
    "pointer-events": "none",
    opacity: String(settings.opacity),
    transform: shadowMatrix(meta, settings),
  });
  layer.append(cast);
  // Sweep only the measured cast/body contact, leaving its source perimeter fixed.
  const [a, b, c, d, e, f] = shadowMatrix(meta, settings)
      .slice(7, -1)
      .split(" ")
      .map(Number),
    determinant = a * d - b * c;
  if (Math.abs(determinant) > 1e-12 && !preserveSource) {
    const inverseMatrix = [d, -b, -c, a, c * f - d * e, b * e - a * f]
      .map((value) => (value / determinant).toFixed(6))
      .join(" ");
    const overlap =
      ((meta as ShadowMetadata & { attachment_overlap?: number })
        .attachment_overlap ?? 1) *
      Math.max(1, Math.hypot(a, b), Math.hypot(c, d));
    const corners = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ];
    const covered = [
      ...corners,
      ...corners.map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]),
    ];
    const margin = overlap + 2;
    const left = Math.min(...covered.map((p) => p[0])) - margin;
    const top = Math.min(...covered.map((p) => p[1])) - margin;
    const bounds = {
      x: String(left),
      y: String(top),
      width: String(Math.max(...covered.map((p) => p[0])) - left + margin),
      height: String(Math.max(...covered.map((p) => p[1])) - top + margin),
    };
    const bridgeMask = inverse.cloneNode(true) as SVGElement;
    bridgeMask.setAttribute("id", "custom-bridge-mask");
    for (const [key, value] of Object.entries(bounds)) {
      bridgeMask.setAttribute(key, value);
      bridgeMask.firstElementChild!.setAttribute(key, value);
    }
    defs.append(bridgeMask);
    const bridge = create("g", {
      "data-shadow-attachment": "true",
      "data-shadow-bridge": "true",
      transform: `matrix(${inverseMatrix})`,
      mask: "url(#custom-bridge-mask)",
    });
    const color =
      paths.get(meta.cast_path_ids![0])?.getAttribute("fill") ?? "#181817";
    const edges = meta.attachment_edges ?? [];
    const castEdges = meta.attachment_cast_edges ?? edges;
    const commands: string[] = [];
    for (const [index, [x1, y1, x2, y2]] of edges.entries()) {
      const [cx1, cy1, cx2, cy2] = castEdges[index];
      const points = [
        [x1, y1],
        [x2, y2],
        [a * cx2 + c * cy2 + e, b * cx2 + d * cy2 + f],
        [a * cx1 + c * cy1 + e, b * cx1 + d * cy1 + f],
      ];
      for (const triangle of [
        [points[0], points[1], points[2]],
        [points[0], points[2], points[3]],
      ]) {
        const [p, q, r] = triangle;
        const area =
          (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        if (Math.abs(area) < 1e-10) continue;
        if (area < 0) triangle.reverse();
        commands.push(
          "M" +
            triangle
              .map((p) => p.map((n) => n.toFixed(6)).join(","))
              .join(" L") +
            " Z",
        );
      }
    }
    bridge.append(
      create("path", {
        "data-shadow-mesh": "true",
        d: commands.join(" "),
        fill: color,
        "fill-rule": "nonzero",
        stroke: color,
        "stroke-width": String(overlap),
        "stroke-linejoin": "round",
      }),
    );
    layer.append(bridge);
  }
  if (!effect.separateLayers && identity) {
    layer.setAttribute("display", "none");
    for (const child of children)
      child.setAttribute("data-shadow-body", "true");
    root.append(defs, layer, ...children);
    return;
  }
  root.append(defs, layer, body);
}
