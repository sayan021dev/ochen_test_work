import { useMemo, useRef, useLayoutEffect, useState, useEffect } from "react";
import {
  Copy,
  BringToFront,
  SendToBack,
  Trash2,
  MousePointer2,
  RotateCcw,
  Sun,
} from "lucide-react";
import {
  elementCorners,
  elementPoint,
  frameCorners,
  framePatch,
  framePoint,
  selectionFrame,
  inverseElementPoint,
  type SelectionFrame,
  resizeElement,
  rotateElement,
  type Point,
  type Handle,
} from "./geometry";
import type { Element } from "./types";
import { useStore } from "zustand";
import type { createEditorStore } from "./state";
import { Illustration, type AssetSources as Assets } from "./Illustration";
export { Illustration } from "./Illustration";
import { FORMATS, type Asset, type Scene, type SceneLight } from "./types";
import { useShadowFeatures } from "./features";
import { effectiveShadow } from "./lighting";

export type EditorStore = ReturnType<typeof createEditorStore>;

export function clampLightToCanvas(
  p: Point,
  width: number,
  height: number,
  camera: number,
): Point {
  const marginX = Math.min(width / 2, 20 / Math.max(camera, 1e-9));
  const marginY = Math.min(height / 2, 36 / Math.max(camera, 1e-9));
  return {
    x: Math.max(marginX, Math.min(width - marginX, p.x)),
    y: Math.max(marginY, Math.min(height - marginY, p.y)),
  };
}

// SVG masks affect painting, but the browser still dispatches pointer events to
// masked-out paths. Test the same prepared vector masks used by the artwork.
function containsInk(
  node: SVGElement | null,
  point: DOMPoint,
  outline = false,
): boolean {
  if (!node) return false;
  let local = point;
  if (node instanceof SVGGraphicsElement) {
    const list = node.transform.baseVal;
    for (let i = 0; i < list.numberOfItems; i++)
      local = local.matrixTransform(list.getItem(i).matrix.inverse());
  }
  if (node instanceof SVGGeometryElement) {
    const style = getComputedStyle(node);
    return (
      (style.fill !== "none" && node.isPointInFill(local)) ||
      (outline && style.stroke !== "none" && node.isPointInStroke(local))
    );
  }
  return Array.from(node.children).some((child) =>
    containsInk(child as SVGElement, local, outline),
  );
}

function pickPart(
  stage: SVGSVGElement,
  location: Point,
  event: React.PointerEvent<SVGSVGElement>,
  scene: Scene,
  assets: Asset[],
  customShadowsEnabled: boolean,
) {
  const nativeHits = new Set(
    document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((node) => node.closest("[data-element-id]"))
      .filter(Boolean),
  );
  const candidates = [
    ...stage.querySelectorAll<SVGGElement>("[data-element-id]"),
  ]
    .reverse()
    .map((group) => {
      const e = scene.elements.find(
        (item) => item.id === group.dataset.elementId,
      )!;
      const asset = assets.find(
        (a) =>
          a.family === e.family &&
          a.detail === scene.detail &&
          a.role === e.role,
      )!;
      const shadow = effectiveShadow(scene, e, asset, customShadowsEnabled);
      const local = inverseElementPoint(e, scene.scale, location),
        p = new DOMPoint(local.x, local.y);
      const reviewed =
        group
          .querySelector<SVGElement>('[data-mask-part="body"]')
          ?.closest("mask") ?? null;
      const reviewedBody = (point: DOMPoint) =>
        !!reviewed &&
        containsInk(reviewed.firstElementChild as SVGElement, point, true) &&
        !(
          reviewed.children[1] &&
          containsInk(reviewed.children[1] as SVGElement, point, true)
        );
      const castOwner =
        stage.querySelector<SVGGElement>(
          `[data-shadow-owner-id="${CSS.escape(e.id)}"]`,
        ) ?? group;
      const layer = castOwner.querySelector<SVGGElement>(
        "[data-custom-shadow],[data-source-shadow]",
      );
      const projected =
        layer?.getAttribute("data-shadow-source") === "body-silhouette";
      const subject = layer?.querySelector<SVGElement>("[data-shadow-subject]");
      const clipFor = (node: globalThis.Element | null | undefined) => {
        const id = node
          ?.getAttribute("clip-path")
          ?.match(/url\(#([^)]*)\)/)?.[1];
        return id
          ? stage.querySelector<SVGElement>(`#${CSS.escape(id)}`)
          : null;
      };
      const clip = clipFor(subject?.parentElement);
      const sourceInk = (point: DOMPoint) =>
        !reviewedBody(point) &&
        containsInk(subject ?? null, point, true) &&
        (!clip || containsInk(clip, point));
      const cut = group.querySelector<SVGElement>(
        "[data-source-body-mask] [data-mask-cut]",
      );
      const cutClip = clipFor(cut);
      const cutInk = (point: DOMPoint) =>
        !!cut &&
        containsInk(cut, point, true) &&
        !reviewedBody(point) &&
        (!cutClip || containsInk(cutClip, point));
      const body = group.querySelector<SVGElement>("[data-shadow-body]");
      const subjectMask = (
        subject?.hasAttribute("mask")
          ? subject
          : subject?.querySelector("[mask]")
      )
        ?.getAttribute("mask")
        ?.match(/url\(#([^)]*)\)/)?.[1];
      const sourceBodyMask = subjectMask
        ? !!stage.querySelector(
            `#${CSS.escape(subjectMask)}[data-source-body-mask]`,
          )
        : false;
      const bodyInk = (point: DOMPoint, content: SVGElement | null = body) =>
        (containsInk(content, point, true) &&
          (projected && !sourceBodyMask
            ? reviewedBody(point)
            : !cutInk(point))) ||
        containsInk(
          content?.querySelector<SVGElement>("[data-shadow-body-repair]") ??
            null,
          point,
          true,
        );
      return {
        group,
        e,
        shadow,
        p,
        reviewed,
        reviewedBody,
        layer,
        projected,
        subject,
        sourceInk,
        bodyInk,
      };
    });
  // Every visible body is above every scene shadow, including other owners.
  for (const c of candidates) {
    if (
      c.projected
        ? c.bodyInk(c.p)
        : nativeHits.has(c.group) &&
          (!c.reviewed || (!c.shadow ? !c.sourceInk(c.p) : c.reviewedBody(c.p)))
    )
      return { e: c.e, part: "object" as const };
  }
  for (const c of candidates) {
    const { e, layer } = c;
    if (!layer) {
      if (nativeHits.has(c.group)) return { e, part: "object" as const };
      continue;
    }
    const settings = c.shadow ?? { angle: 0, length: 1, opacity: 1 };
    if (settings.opacity <= 0 || !layer.transform.baseVal.numberOfItems)
      continue;
    const matrix = layer.transform.baseVal.getItem(0).matrix;
    if (Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-12) continue;
    const p = c.p.matrixTransform(matrix.inverse());
    if (c.projected) {
      if (!c.bodyInk(c.p) && c.bodyInk(p, c.subject ?? null))
        return {
          e,
          part:
            customShadowsEnabled && !scene.light?.enabled && e.shadow
              ? ("shadow" as const)
              : ("object" as const),
        };
      continue;
    }
    const a = assets.find(
      (a) =>
        a.family === e.family && a.detail === scene.detail && a.role === e.role,
    )!;
    const box = a.shadow.cast_bbox;
    if (
      box &&
      p.x >= box[0] &&
      p.x <= box[0] + box[2] &&
      p.y >= box[1] &&
      p.y <= box[1] + box[3] &&
      c.sourceInk(p)
    )
      return {
        e,
        part:
          customShadowsEnabled && !scene.light?.enabled && e.shadow
            ? ("shadow" as const)
            : ("object" as const),
      };
  }
}

export function Canvas({
  store,
  assets,
  sources,
  zoom,
  busy,
  locked = false,
  onSelectLight,
}: Assets & {
  store: EditorStore;
  zoom: number;
  busy: boolean;
  locked?: boolean;
  onSelectLight?: () => void;
}) {
  const { customShadows } = useShadowFeatures();
  const { scene, selected, selectedPart } = useStore(store),
    svg = useRef<SVGSVGElement>(null),
    host = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const globalLight = customShadows && !!scene.light?.enabled;
  const canEditShadows = customShadows && !globalLight;
  const lightDrag = useRef<{
    start: Point;
    light: SceneLight;
    epoch: number;
    pointerId: number;
  } | null>(null);
  const viewCenter = useRef<{ format: Scene["format"]; point: Point } | null>(
    null,
  );
  const [size, setSize] = useState({ width: 800, height: 600 }),
    [toolbar, setToolbar] = useState({ left: 8, top: 8 });
  const [width, height] = FORMATS[scene.format];
  const fit = Math.max(
    0.02,
    Math.min((size.width - 64) / width, (size.height - 64) / height),
  );
  const camera = fit * zoom;
  const element = scene.elements.find((e) => e.id === selected && !e.hidden),
    asset = element
      ? assets.find(
          (a) =>
            a.family === element.family &&
            a.detail === scene.detail &&
            a.role === element.role,
        )
      : undefined;
  type Gesture = {
    kind: "move" | "resize" | "rotate";
    element: Element;
    start: Point;
    epoch: number;
    frame: SelectionFrame;
    pointerId: number;
    handle?: Handle;
    angle?: number;
    center?: Point;
  };
  const drag = useRef<Gesture | null>(null);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const frame = useMemo(
    () =>
      element && asset
        ? selectionFrame(
            canEditShadows && selectedPart === "shadow"
              ? {
                  ...element,
                  shadow: effectiveShadow(scene, element, asset, customShadows),
                }
              : element,
            asset,
            scene.scale,
            canEditShadows ? selectedPart : "object",
          )
        : null,
    [element, asset, scene, selectedPart, customShadows, canEditShadows],
  );
  const corners = useMemo(() => (frame ? frameCorners(frame) : []), [frame]);
  const editingShadow = !!frame?.owner;
  useEffect(() => {
    if (!canEditShadows && selectedPart === "shadow")
      store.getState().select(selected);
  }, [canEditShadows, selectedPart, selected, store]);
  useEffect(() => {
    if (!busy && !locked) return;
    const active = lightDrag.current ?? drag.current;
    if (active?.epoch === store.getState().documentEpoch)
      store.getState().cancelDrag();
    lightDrag.current = null;
    drag.current = null;
  }, [busy, locked, store]);

  useEffect(
    () => () => {
      const active = lightDrag.current ?? drag.current;
      if (active?.epoch === store.getState().documentEpoch)
        store.getState().cancelDrag();
      lightDrag.current = null;
      drag.current = null;
    },
    [store],
  );

  // Preserve the point under the viewport center through zoom and window resizing.
  useLayoutEffect(() => {
    const pane = scroll.current,
      board = svg.current;
    if (!pane || !board) return;
    const middle = () => {
      const box = pane.getBoundingClientRect();
      return new DOMPoint(
        box.left + pane.clientWidth / 2,
        box.top + pane.clientHeight / 2,
      );
    };
    const previous = viewCenter.current;
    const center =
      previous?.format === scene.format
        ? previous.point
        : { x: width / 2, y: height / 2 };
    const ctm = board.getScreenCTM();
    if (!ctm) return;
    const wanted = new DOMPoint(center.x, center.y).matrixTransform(ctm),
      mid = middle();
    pane.scrollLeft += wanted.x - mid.x;
    pane.scrollTop += wanted.y - mid.y;
    const remember = () => {
      const m = board.getScreenCTM();
      if (m)
        viewCenter.current = {
          format: scene.format,
          point: middle().matrixTransform(m.inverse()),
        };
    };
    remember();
    pane.addEventListener("scroll", remember);
    return () => pane.removeEventListener("scroll", remember);
  }, [scene.format, camera, width, height, size]);

  useLayoutEffect(() => {
    const board = svg.current,
      container = host.current,
      pane = scroll.current;
    if (!corners.length || !board || !container || !pane) return;
    const place = () => {
      const matrix = board.getScreenCTM();
      if (!matrix) return;
      const box = container.getBoundingClientRect(),
        points = corners.map((p) =>
          new DOMPoint(p.x, p.y).matrixTransform(matrix),
        );
      const top = Math.min(...points.map((p) => p.y)) - box.top;
      setToolbar({
        left: Math.max(
          8,
          Math.min(
            pane.clientWidth - 174,
            Math.min(...points.map((p) => p.x)) - box.left,
          ),
        ),
        top: Math.max(
          8,
          Math.min(
            pane.clientHeight - 42,
            top > 92
              ? top - 82
              : Math.max(...points.map((p) => p.y)) - box.top + 12,
          ),
        ),
      });
    };
    place();
    pane.addEventListener("scroll", place);
    return () => pane.removeEventListener("scroll", place);
  }, [corners, camera, size]);
  const point = (event: { clientX: number; clientY: number }) =>
    new DOMPoint(event.clientX, event.clientY).matrixTransform(
      svg.current!.getScreenCTM()!.inverse(),
    );
  const startGesture = (event: React.PointerEvent<SVGSVGElement>) => {
    if (
      busy ||
      locked ||
      drag.current ||
      lightDrag.current ||
      event.button !== 0
    )
      return;
    if (
      (event.target as SVGElement).closest("[data-light-marker]") &&
      globalLight &&
      scene.light
    ) {
      event.preventDefault();
      const current = store.getState();
      current.select(null);
      onSelectLight?.();
      current.beginDrag();
      lightDrag.current = {
        start: point(event),
        light: scene.light,
        epoch: current.documentEpoch,
        pointerId: event.pointerId,
      };
      svg.current?.setPointerCapture(event.pointerId);
      return;
    }
    const handle = (event.target as SVGElement).closest<SVGElement>(
      "[data-resize-handle],[data-rotate-handle],[data-shadow-frame-move]",
    );
    const current = store.getState(),
      scenePoint = point(event);
    const hit =
      handle && element
        ? {
            e: element,
            part: canEditShadows ? selectedPart : ("object" as const),
          }
        : pickPart(
            svg.current!,
            scenePoint,
            event,
            current.scene,
            assets,
            customShadows,
          );
    svg.current?.focus({ preventScroll: true });
    if (!hit) {
      current.select(null);
      return;
    }
    const { e, part } = hit;
    const a = assets.find(
      (a) =>
        a.family === e.family &&
        a.detail === current.scene.detail &&
        a.role === e.role,
    )!;
    if (part === "shadow") current.selectShadow(e.id);
    else current.select(e.id);
    event.preventDefault();
    if (e.locked) return;
    const f = selectionFrame(
        part === "shadow"
          ? {
              ...e,
              shadow: effectiveShadow(current.scene, e, a, customShadows),
            }
          : e,
        a,
        current.scene.scale,
        part,
      ),
      p = framePoint(f, scenePoint);
    const localCorners = elementCorners(f.element, f.scale, f.width, f.height);
    const center = f.projection?.anchor ?? {
      x: (localCorners[0].x + localCorners[2].x) / 2,
      y: (localCorners[0].y + localCorners[2].y) / 2,
    };
    current.beginDrag();
    drag.current = {
      kind: handle?.hasAttribute("data-resize-handle")
        ? "resize"
        : handle?.hasAttribute("data-rotate-handle")
          ? "rotate"
          : "move",
      element: e,
      frame: f,
      start: p,
      epoch: current.documentEpoch,
      pointerId: event.pointerId,
      handle: handle?.dataset.resizeHandle as Handle | undefined,
      center,
      angle: Math.atan2(p.y - center.y, p.x - center.x),
    };
    svg.current?.setPointerCapture(event.pointerId);
  };
  const finish = (event: React.PointerEvent<SVGSVGElement>) => {
    if (lightDrag.current?.pointerId === event.pointerId) {
      if (lightDrag.current.epoch === store.getState().documentEpoch)
        store.getState().finishDrag();
      lightDrag.current = null;
      return;
    }
    if (drag.current?.pointerId !== event.pointerId) return;
    if (drag.current.epoch === store.getState().documentEpoch)
      store.getState().finishDrag();
    drag.current = null;
  };
  const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const positions = corners.length
    ? [
        corners[0],
        {
          x: (corners[0].x + corners[1].x) / 2,
          y: (corners[0].y + corners[1].y) / 2,
        },
        corners[1],
        {
          x: (corners[1].x + corners[2].x) / 2,
          y: (corners[1].y + corners[2].y) / 2,
        },
        corners[2],
        {
          x: (corners[2].x + corners[3].x) / 2,
          y: (corners[2].y + corners[3].y) / 2,
        },
        corners[3],
        {
          x: (corners[3].x + corners[0].x) / 2,
          y: (corners[3].y + corners[0].y) / 2,
        },
      ]
    : [];
  const shadowAnchor =
    frame?.owner && frame.projection
      ? elementPoint(frame.owner, frame.sceneScale, frame.projection.anchor)
      : null;
  const shadowEndpoint =
    frame?.owner && frame.projection
      ? elementPoint(frame.owner, frame.sceneScale, frame.element)
      : null;
  const top = editingShadow ? shadowEndpoint : positions[1];
  const edge = top && {
    x: corners[1].x - corners[0].x,
    y: corners[1].y - corners[0].y,
  };
  const edgeSize = edge ? Math.hypot(edge.x, edge.y) : 0;
  const shadowVector =
    shadowAnchor && shadowEndpoint
      ? {
          x: shadowEndpoint.x - shadowAnchor.x,
          y: shadowEndpoint.y - shadowAnchor.y,
        }
      : null;
  const vectorSize = shadowVector
    ? Math.hypot(shadowVector.x, shadowVector.y)
    : 0;
  const rotation =
    editingShadow && top && shadowVector
      ? {
          x:
            top.x +
            ((vectorSize ? shadowVector.y / vectorSize : 0) * 28) / camera,
          y:
            top.y -
            ((vectorSize ? shadowVector.x / vectorSize : 1) * 28) / camera,
        }
      : top && edgeSize && edge
        ? {
            x: top.x + ((edge.y / edgeSize) * 30) / camera,
            y: top.y - ((edge.x / edgeSize) * 30) / camera,
          }
        : null;
  return (
    <div ref={host} className="canvas-host">
      <div ref={scroll} className="canvas-scroll" data-testid="canvas-scroll">
        <div
          className="canvas-sheet"
          style={{ width: width * camera + 64, height: height * camera + 64 }}
        >
          <svg
            ref={svg}
            data-testid="artboard"
            className="artboard"
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: width * camera, height: height * camera }}
            tabIndex={0}
            role="group"
            aria-label="Холст композиции"
            onPointerDown={startGesture}
            onPointerMove={(event) => {
              const light = lightDrag.current;
              if (
                light &&
                light.pointerId === event.pointerId &&
                light.epoch === store.getState().documentEpoch &&
                !busy &&
                !locked &&
                globalLight
              ) {
                const p = point(event);
                store.getState().previewLight({
                  ...light.light,
                  ...clampLightToCanvas(
                    {
                      x: light.light.x + p.x - light.start.x,
                      y: light.light.y + p.y - light.start.y,
                    },
                    width,
                    height,
                    camera,
                  ),
                });
                return;
              }
              const d = drag.current;
              if (
                !d ||
                event.pointerId !== d.pointerId ||
                d.epoch !== store.getState().documentEpoch
              )
                return;
              const f = d.frame;
              if (f.owner && !canEditShadows) return;
              const p = framePoint(f, point(event)),
                current = store.getState();
              if (d.kind === "move" && !f.owner) {
                current.previewMove(
                  d.element.id,
                  d.element.x + p.x - d.start.x,
                  d.element.y + p.y - d.start.y,
                );
                return;
              }
              let next = f.element;
              if (f.owner && f.projection) {
                if (d.kind === "rotate") {
                  let angle =
                    next.angle +
                    ((Math.atan2(p.y - d.center!.y, p.x - d.center!.x) -
                      d.angle!) *
                      180) /
                      Math.PI;
                  if (event.shiftKey) angle = Math.round(angle / 15) * 15;
                  next = { ...next, angle };
                } else
                  next = {
                    ...next,
                    x: next.x + p.x - d.start.x,
                    y: next.y + p.y - d.start.y,
                  };
                current.previewElement(d.element.id, framePatch(f, next));
                return;
              }
              if (d.kind === "move")
                next = {
                  ...next,
                  x: next.x + p.x - d.start.x,
                  y: next.y + p.y - d.start.y,
                };
              else if (d.kind === "resize")
                next = resizeElement(
                  next,
                  f.scale,
                  f.width,
                  f.height,
                  d.handle!,
                  p,
                  !f.owner,
                );
              else {
                let angle =
                  next.angle +
                  ((Math.atan2(p.y - d.center!.y, p.x - d.center!.x) -
                    d.angle!) *
                    180) /
                    Math.PI;
                if (event.shiftKey) angle = Math.round(angle / 15) * 15;
                next = rotateElement(
                  next,
                  f.scale,
                  f.width,
                  f.height,
                  angle,
                  !f.owner,
                );
              }
              current.previewElement(d.element.id, framePatch(f, next));
            }}
            onPointerUp={finish}
            onPointerCancel={(event) => {
              if (lightDrag.current?.pointerId === event.pointerId) {
                if (lightDrag.current.epoch === store.getState().documentEpoch)
                  store.getState().cancelDrag();
                lightDrag.current = null;
                return;
              }
              if (drag.current?.pointerId !== event.pointerId) return;
              if (drag.current.epoch === store.getState().documentEpoch)
                store.getState().cancelDrag();
              drag.current = null;
            }}
            onLostPointerCapture={finish}
          >
            <Illustration
              scene={scene}
              assets={assets}
              sources={sources}
              prefix="stage"
            />
            {globalLight && scene.light && (
              <g
                data-light-marker="true"
                transform={`translate(${scene.light.x} ${scene.light.y})`}
                role="button"
                tabIndex={0}
                aria-label="Источник света"
                className="scene-light-marker"
                style={{ cursor: busy || locked ? "default" : "grab" }}
                onFocus={() => {
                  store.getState().select(null);
                  onSelectLight?.();
                }}
                onKeyDown={(event) => {
                  if (
                    ![
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                    ].includes(event.key) ||
                    busy ||
                    locked
                  )
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  const current = store.getState(),
                    light = current.scene.light;
                  if (!light?.enabled) return;
                  const delta = event.shiftKey ? 10 : 1;
                  current.change({
                    ...current.scene,
                    light: {
                      ...light,
                      ...clampLightToCanvas(
                        {
                          x:
                            light.x +
                            (event.key === "ArrowRight"
                              ? delta
                              : event.key === "ArrowLeft"
                                ? -delta
                                : 0),
                          y:
                            light.y +
                            (event.key === "ArrowDown"
                              ? delta
                              : event.key === "ArrowUp"
                                ? -delta
                                : 0),
                        },
                        width,
                        height,
                        camera,
                      ),
                    },
                  });
                }}
              >
                <circle
                  r={15 / camera}
                  fill="#3d303b"
                  stroke="#ff8bb9"
                  strokeWidth={1.5 / camera}
                />
                <g transform={`scale(${1 / camera})`} pointerEvents="none">
                  <Sun x={-9} y={-9} size={18} color="#ffd4a2" />
                </g>
                <rect
                  x={-20 / camera}
                  y={18 / camera}
                  width={40 / camera}
                  height={17 / camera}
                  rx={4 / camera}
                  fill="#242427"
                  pointerEvents="none"
                />
                <text
                  y={30 / camera}
                  textAnchor="middle"
                  fontSize={11 / camera}
                  fill="#f3d4df"
                  pointerEvents="none"
                >
                  Свет
                </text>
              </g>
            )}
            {element && frame && (
              <g
                className="selection-controls"
                data-selected-part={editingShadow ? "shadow" : "object"}
              >
                {editingShadow && !element.locked && (
                  <path
                    d={`M${corners.map((p) => `${p.x} ${p.y}`).join("L")}Z`}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={8 / camera}
                    pointerEvents="stroke"
                    data-shadow-frame-move="true"
                    style={{ cursor: "move" }}
                  />
                )}
                <path
                  d={`M${corners.map((p) => `${p.x} ${p.y}`).join("L")}Z`}
                  fill="none"
                  stroke="#FF68A4"
                  strokeWidth={1.5 / camera}
                  pointerEvents="none"
                />
                {!element.locked && rotation && (
                  <>
                    {!editingShadow &&
                      positions.map((p, i) => (
                        <rect
                          key={handles[i]}
                          data-resize-handle={handles[i]}
                          role="button"
                          tabIndex={0}
                          aria-label={`Размер ${editingShadow ? "тени" : "объекта"}: ${handles[i]}`}
                          onKeyDown={(event) => {
                            if (
                              ![
                                "ArrowLeft",
                                "ArrowRight",
                                "ArrowUp",
                                "ArrowDown",
                              ].includes(event.key)
                            )
                              return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (drag.current || busy) return;
                            const step = (event.shiftKey ? 10 : 1) / camera;
                            const target = {
                              x:
                                p.x +
                                (event.key === "ArrowRight"
                                  ? step
                                  : event.key === "ArrowLeft"
                                    ? -step
                                    : 0),
                              y:
                                p.y +
                                (event.key === "ArrowDown"
                                  ? step
                                  : event.key === "ArrowUp"
                                    ? -step
                                    : 0),
                            };
                            const next = resizeElement(
                              frame.element,
                              frame.scale,
                              frame.width,
                              frame.height,
                              handles[i],
                              framePoint(frame, target),
                              !frame.owner,
                            );
                            store
                              .getState()
                              .patchElement(
                                element.id,
                                framePatch(frame, next),
                              );
                          }}
                          x={p.x - 4 / camera}
                          y={p.y - 4 / camera}
                          width={8 / camera}
                          height={8 / camera}
                          fill="white"
                          stroke="#FF68A4"
                          strokeWidth={1 / camera}
                          style={{ cursor: `${handles[i]}-resize` }}
                        />
                      ))}
                    {editingShadow && shadowAnchor && shadowEndpoint && (
                      <>
                        <line
                          x1={shadowAnchor.x}
                          y1={shadowAnchor.y}
                          x2={shadowEndpoint.x}
                          y2={shadowEndpoint.y}
                          stroke="#FF68A4"
                          strokeWidth={1 / camera}
                          strokeDasharray={`${4 / camera} ${3 / camera}`}
                          pointerEvents="none"
                        />
                        <circle
                          data-shadow-anchor="true"
                          cx={shadowAnchor.x}
                          cy={shadowAnchor.y}
                          r={3 / camera}
                          fill="#FF68A4"
                          pointerEvents="none"
                        />
                        <circle
                          data-resize-handle="e"
                          data-shadow-vector-handle="true"
                          role="button"
                          tabIndex={0}
                          aria-label="Направление и длина тени"
                          onKeyDown={(event) => {
                            if (
                              ![
                                "ArrowLeft",
                                "ArrowRight",
                                "ArrowUp",
                                "ArrowDown",
                              ].includes(event.key)
                            )
                              return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (drag.current || busy) return;
                            const step = (event.shiftKey ? 10 : 1) / camera;
                            const target = framePoint(frame, {
                              x:
                                shadowEndpoint.x +
                                (event.key === "ArrowRight"
                                  ? step
                                  : event.key === "ArrowLeft"
                                    ? -step
                                    : 0),
                              y:
                                shadowEndpoint.y +
                                (event.key === "ArrowDown"
                                  ? step
                                  : event.key === "ArrowUp"
                                    ? -step
                                    : 0),
                            });
                            store.getState().patchElement(
                              element.id,
                              framePatch(frame, {
                                ...frame.element,
                                ...target,
                              }),
                            );
                          }}
                          cx={shadowEndpoint.x}
                          cy={shadowEndpoint.y}
                          r={6 / camera}
                          fill="white"
                          stroke="#FF68A4"
                          strokeWidth={2 / camera}
                          style={{ cursor: "crosshair" }}
                        >
                          <title>
                            Потяните, чтобы изменить направление и длину
                          </title>
                        </circle>
                      </>
                    )}
                    <line
                      x1={top!.x}
                      y1={top!.y}
                      x2={rotation!.x}
                      y2={rotation!.y}
                      stroke="#FF68A4"
                      strokeWidth={1 / camera}
                      pointerEvents="none"
                    />
                    <circle
                      data-rotate-handle="true"
                      role="button"
                      tabIndex={0}
                      aria-label={
                        editingShadow ? "Повернуть тень" : "Повернуть объект"
                      }
                      onKeyDown={(event) => {
                        if (!["ArrowLeft", "ArrowRight"].includes(event.key))
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (drag.current || busy) return;
                        const angle =
                          frame.element.angle +
                          (event.key === "ArrowRight" ? 1 : -1) *
                            (event.shiftKey ? 15 : 5);
                        const next = editingShadow
                          ? { ...frame.element, angle }
                          : rotateElement(
                              frame.element,
                              frame.scale,
                              frame.width,
                              frame.height,
                              angle,
                              !frame.owner,
                            );
                        store
                          .getState()
                          .patchElement(element.id, framePatch(frame, next));
                      }}
                      cx={rotation!.x}
                      cy={rotation!.y}
                      r={5 / camera}
                      fill="white"
                      stroke="#FF68A4"
                      strokeWidth={1 / camera}
                      style={{ cursor: "grab" }}
                    />
                  </>
                )}
              </g>
            )}
          </svg>
        </div>
      </div>
      {element && !busy && (
        <div
          className="selection-toolbar"
          role="toolbar"
          aria-label={
            editingShadow ? "Действия с тенью" : "Действия с объектом"
          }
          style={toolbar}
        >
          {editingShadow ? (
            <>
              <button
                aria-label="Выбрать предмет"
                title="Выбрать предмет"
                onClick={() => store.getState().select(element.id)}
              >
                <MousePointer2 size={17} />
              </button>
              <button
                aria-label="Сбросить проекцию тени"
                title="Сбросить проекцию тени"
                disabled={element.locked}
                onClick={() =>
                  store.getState().patchElement(element.id, {
                    shadow: { angle: 90, length: 1, opacity: 1 },
                  })
                }
              >
                <RotateCcw size={17} />
              </button>
              <button
                className="danger"
                aria-label="Отключить свою тень"
                title="Вернуть исходную тень"
                disabled={element.locked}
                onClick={() => {
                  store.getState().patchElement(element.id, { shadow: null });
                  store.getState().select(element.id);
                }}
              >
                <Trash2 size={17} />
              </button>
            </>
          ) : (
            <>
              <button
                aria-label="Дублировать объект"
                title="Дублировать · Ctrl+D"
                onClick={() => store.getState().duplicate()}
              >
                <Copy size={17} />
              </button>
              <button
                aria-label="Переместить слой выше"
                title="Слой выше"
                onClick={() => store.getState().reorder(element.id, 1)}
              >
                <BringToFront size={18} />
              </button>
              <button
                aria-label="Переместить слой ниже"
                title="Слой ниже"
                onClick={() => store.getState().reorder(element.id, -1)}
              >
                <SendToBack size={18} />
              </button>
              <button
                className="danger"
                aria-label="Удалить объект"
                title="Удалить"
                disabled={element.locked}
                onClick={() => store.getState().remove()}
              >
                <Trash2 size={17} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
