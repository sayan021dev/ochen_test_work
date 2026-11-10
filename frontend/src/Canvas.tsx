import { memo, useMemo, useRef } from "react";
import { useStore } from "zustand";
import type { createEditorStore } from "./state";
import { prepareAsset } from "./svg";
import { FORMATS, type Asset, type Palette, type Scene } from "./types";

export type EditorStore = ReturnType<typeof createEditorStore>;
type Assets = { assets: Asset[]; sources: Record<string, string> };

const Artwork = memo(function Artwork({
  source,
  palette,
  id,
}: {
  source: string;
  palette: Palette;
  id: string;
}) {
  const markup = useMemo(
    () => prepareAsset(source, palette, id),
    [source, palette, id],
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
                transform={`translate(${e.x} ${e.y}) rotate(${e.angle}) scale(${scene.scale})`}
              >
                <Artwork
                  source={sources[asset.id]}
                  palette={scene.palette}
                  id={`${prefix}-${e.id}`}
                />
              </g>
            );
          })}
      </g>
    </>
  );
}

export function Canvas({
  store,
  assets,
  sources,
  zoom,
  busy,
}: Assets & { store: EditorStore; zoom: number; busy: boolean }) {
  const { scene, selected } = useStore(store),
    svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    id: string;
    start: DOMPoint;
    x: number;
    y: number;
  } | null>(null);
  const [width, height] = FORMATS[scene.format];
  const point = (x: number, y: number) =>
    new DOMPoint(x, y).matrixTransform(svg.current!.getScreenCTM()!.inverse());
  return (
    <svg
      ref={svg}
      data-testid="artboard"
      className="artboard"
      viewBox={`0 0 ${width} ${height}`}
      style={{ transform: `scale(${zoom})` }}
      tabIndex={0}
      role="group"
      aria-label="Холст композиции"
      onPointerDown={(event) => {
        if (busy) return;
        const target = (event.target as SVGElement).closest<SVGGElement>(
          "[data-element-id]",
        );
        if (!target) {
          store.getState().select(null);
          svg.current?.focus();
          return;
        }
        const id = target.dataset.elementId!,
          element = scene.elements.find((e) => e.id === id)!;
        store.getState().select(id);
        svg.current?.focus();
        event.preventDefault();
        if (element.locked) return;
        store.getState().beginDrag();
        drag.current = {
          id,
          start: point(event.clientX, event.clientY),
          x: element.x,
          y: element.y,
        };
        svg.current?.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const position = point(event.clientX, event.clientY),
          d = drag.current;
        store
          .getState()
          .previewMove(
            d.id,
            d.x + position.x - d.start.x,
            d.y + position.y - d.start.y,
          );
      }}
      onPointerUp={() => {
        if (drag.current) {
          store.getState().finishDrag();
          drag.current = null;
        }
      }}
      onPointerCancel={() => {
        store.getState().cancelDrag();
        drag.current = null;
      }}
    >
      <Illustration
        scene={scene}
        assets={assets}
        sources={sources}
        prefix="stage"
      />
      {scene.elements
        .filter((e) => e.id === selected && !e.hidden)
        .map((e) => {
          const asset = assets.find(
            (a) =>
              a.family === e.family &&
              a.detail === scene.detail &&
              a.role === e.role,
          )!;
          return (
            <g
              key={e.id}
              pointerEvents="none"
              transform={`translate(${e.x} ${e.y}) rotate(${e.angle}) scale(${scene.scale})`}
            >
              <rect
                className="selection-outline"
                x={-8 / scene.scale}
                y={-8 / scene.scale}
                width={asset.width + 16 / scene.scale}
                height={asset.height + 16 / scene.scale}
                fill="none"
                stroke="#FF68A4"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              {[
                [-8 / scene.scale, -8 / scene.scale],
                [asset.width + 8 / scene.scale, -8 / scene.scale],
                [-8 / scene.scale, asset.height + 8 / scene.scale],
                [asset.width + 8 / scene.scale, asset.height + 8 / scene.scale],
              ].map(([x, y], i) => (
                <rect
                  key={i}
                  x={x - 3 / scene.scale}
                  y={y - 3 / scene.scale}
                  width={6 / scene.scale}
                  height={6 / scene.scale}
                  fill="#fff"
                  stroke="#FF68A4"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          );
        })}
    </svg>
  );
}
