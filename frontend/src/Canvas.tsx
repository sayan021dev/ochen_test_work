import { memo, useMemo, useRef, useLayoutEffect, useState } from "react";
import {
  Copy,
  BringToFront,
  SendToBack,
  Trash2,
  MousePointer2,
  RotateCcw,
} from "lucide-react";
import {
  elementCorners,
  frameCorners,
  framePatch,
  framePoint,
  selectionFrame,
  inverseElementPoint,
  type SelectionFrame,
  elementTransform,
  resizeElement,
  rotateElement,
  type Point,
  type Handle,
} from "./geometry";
import type { Element } from "./types";
import { useStore } from "zustand";
import type { createEditorStore } from "./state";
import { prepareAsset } from "./svg";
import {
  FORMATS,
  type Asset,
  type Palette,
  type Scene,
  type Shadow,
} from "./types";

export type EditorStore = ReturnType<typeof createEditorStore>;
type Assets = { assets: Asset[]; sources: Record<string, string> };

const Artwork = memo(function Artwork({
  source,
  palette,
  id,
  shadow,
  asset,
}: {
  source: string;
  palette: Palette;
  id: string;
  shadow?: Shadow | null;
  asset: Asset;
}) {
  const markup = useMemo(
    () =>
      prepareAsset(
        source,
        palette,
        id,
        shadow
          ? {
              settings: shadow,
              metadata: asset.shadow,
              role: asset.role,
              width: asset.width,
              height: asset.height,
            }
          : undefined,
      ),
    [source, palette, id, shadow, asset],
  );
  return <g fill="none" dangerouslySetInnerHTML={{ __html: markup }} />;
});

export function Illustration({
  scene,
  assets,
  sources,
  prefix = "preview",
}: Assets & { scene: Scene; prefix?: string }) {
  return (
    <>
      {!scene.transparent && (
        <rect
          data-background="true"
          width={FORMATS[scene.format][0]}
          height={FORMATS[scene.format][1]}
          fill={scene.palette.background[0]}
        />
      )}
      <defs>
        <clipPath id={`${prefix}-clip`}>
          <rect
            width={FORMATS[scene.format][0]}
            height={FORMATS[scene.format][1]}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${prefix}-clip)`}>
        {scene.elements
          .filter((e) => !e.hidden)
          .map((e) => {
            const asset = assets.find(
              (a) =>
                a.family === e.family &&
                a.detail === scene.detail &&
                a.role === e.role,
            );
            if (!asset || !sources[asset.id]) return null;
            return (
              <g
                key={e.id}
                data-element-id={e.id}
                data-family={e.family}
                data-source-node={asset.source_node_id}
                transform={elementTransform(scene, e)}
              >
                <Artwork
                  source={sources[asset.id]}
                  palette={scene.palette}
                  id={`${prefix}-${e.id}`}
                  shadow={e.shadow}
                  asset={asset}
                />
              </g>
            );
          })}
      </g>
    </>
  );
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
  if (node instanceof SVGGeometryElement)
    return (
      node.isPointInFill(local) || (outline && node.isPointInStroke(local))
    );
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
) {
  const nativeHits = new Set(
    document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((node) => node.closest("[data-element-id]"))
      .filter(Boolean),
  );
  const groups = [
    ...stage.querySelectorAll<SVGGElement>("[data-element-id]"),
  ].reverse();
  for (const group of groups) {
    const e = scene.elements.find(
      (item) => item.id === group.dataset.elementId,
    )!;
    if (!e.shadow) {
      if (nativeHits.has(group)) return { e, part: "object" as const };
      continue;
    }
    const a = assets.find(
      (a) =>
        a.family === e.family && a.detail === scene.detail && a.role === e.role,
    )!;
    const mask = group.querySelector("mask");
    const layer = group.querySelector<SVGGElement>("[data-custom-shadow]");
    if (!mask || !layer) continue;
    const local = inverseElementPoint(e, scene.scale, location);
    const bodyMask = (p: DOMPoint) =>
      containsInk(mask.firstElementChild as SVGElement, p, true) &&
      !(
        mask.children[1] && containsInk(mask.children[1] as SVGElement, p, true)
      );
    if (nativeHits.has(group) && bodyMask(new DOMPoint(local.x, local.y)))
      return { e, part: "object" as const };
    const box = a.shadow.cast_bbox;
    if (e.shadow.length > 0 && e.shadow.opacity > 0 && box) {
      const matrix = layer.transform.baseVal.getItem(0).matrix;
      if (matrix.a * matrix.d === matrix.b * matrix.c) continue;
      const p = new DOMPoint(local.x, local.y).matrixTransform(
        matrix.inverse(),
      );
      if (
        p.x >= box[0] &&
        p.x <= box[0] + box[2] &&
        p.y >= box[1] &&
        p.y <= box[1] + box[3] &&
        !bodyMask(p) &&
        containsInk(layer.querySelector("[data-shadow-subject]"), p)
      ) {
        const clip = group.querySelector<SVGElement>("clipPath");
        if (!clip || containsInk(clip, p))
          return { e, part: "shadow" as const };
      }
    }
    if (nativeHits.has(group) && layer.getAttribute("display") === "none")
      return { e, part: "object" as const };
  }
}

export function Canvas({
  store,
  assets,
  sources,
  zoom,
  busy,
}: Assets & { store: EditorStore; zoom: number; busy: boolean }) {
  const { scene, selected, selectedPart } = useStore(store),
    svg = useRef<SVGSVGElement>(null),
    host = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
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
        ? selectionFrame(element, asset, scene.scale, selectedPart)
        : null,
    [element, asset, scene.scale, selectedPart],
  );
  const corners = useMemo(() => (frame ? frameCorners(frame) : []), [frame]);
  const editingShadow = !!frame?.owner;

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
    if (busy || drag.current || event.button !== 0) return;
    const handle = (event.target as SVGElement).closest<SVGElement>(
      "[data-resize-handle],[data-rotate-handle],[data-shadow-frame-move]",
    );
    const current = store.getState(),
      scenePoint = point(event);
    const hit =
      handle && element
        ? { e: element, part: selectedPart }
        : pickPart(svg.current!, scenePoint, event, current.scene, assets);
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
    const f = selectionFrame(e, a, current.scene.scale, part),
      p = framePoint(f, scenePoint);
    const localCorners = elementCorners(f.element, f.scale, f.width, f.height);
    const center = {
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
  const top = positions[1];
  const edge = top && {
    x: corners[1].x - corners[0].x,
    y: corners[1].y - corners[0].y,
  };
  const edgeSize = edge ? Math.hypot(edge.x, edge.y) : 0;
  const rotation =
    top && edgeSize && edge
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
              const d = drag.current;
              if (
                !d ||
                event.pointerId !== d.pointerId ||
                d.epoch !== store.getState().documentEpoch
              )
                return;
              const f = d.frame,
                p = framePoint(f, point(event)),
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
                    {positions.map((p, i) => (
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
                            .patchElement(element.id, framePatch(frame, next));
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
                    <line
                      x1={top.x}
                      y1={top.y}
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
                        const next = rotateElement(
                          frame.element,
                          frame.scale,
                          frame.width,
                          frame.height,
                          frame.element.angle +
                            (event.key === "ArrowRight" ? 1 : -1) *
                              (event.shiftKey ? 15 : 5),
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
                aria-label="Сбросить настройки тени"
                title="Сбросить настройки тени"
                disabled={element.locked}
                onClick={() =>
                  store.getState().patchElement(element.id, {
                    shadow: { angle: 0, length: 1, opacity: 1 },
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
