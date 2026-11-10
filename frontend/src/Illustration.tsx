import { Fragment, memo, useMemo } from "react";
import { useShadowFeatures } from "./features";
import { effectiveShadow } from "./lighting";
import { supportOrder } from "./support";
import { needsShadowPass, elementTransform } from "./geometry";
import { prepareAsset, prepareAssetLayer } from "./svg";
import {
  FORMATS,
  type Asset,
  type Palette,
  type PaintRole,
  type Scene,
  type Shadow,
} from "./types";

export type AssetSources = { assets: Asset[]; sources: Record<string, string> };

const Artwork = memo(function Artwork({
  source,
  palette,
  id,
  shadow,
  asset,
  pass = "all",
  referenceId,
  receiverOnlyBody = false,
  colorMap,
}: {
  source: string;
  palette: Palette;
  id: string;
  shadow?: Shadow | null;
  asset: Asset;
  pass?: "all" | "body" | "shadow";
  referenceId?: string;
  receiverOnlyBody?: boolean;
  colorMap?: Partial<Record<PaintRole, PaintRole>>;
}) {
  const markup = useMemo(() => {
    const prepared =
      pass !== "all"
        ? prepareAssetLayer(
            source,
            palette,
            id,
            {
              settings: shadow ?? { angle: 0, length: 1, opacity: 1 },
              metadata: asset.shadow,
              role: asset.role,
              width: asset.width,
              height: asset.height,
              receiverOnlyBody,
            },
            pass,
            !!shadow,
            colorMap,
          )
        : prepareAsset(
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
            colorMap,
          );
    if (!referenceId) return prepared;
    const document = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${prepared}</svg>`,
      "image/svg+xml",
    );
    const node = document.querySelector(
      pass === "shadow"
        ? "[data-custom-shadow],[data-source-shadow]"
        : "[data-shadow-body]",
    );
    node?.setAttribute("id", referenceId);
    return [...document.documentElement.children]
      .map((node) => new XMLSerializer().serializeToString(node))
      .join("");
  }, [
    source,
    palette,
    id,
    shadow,
    asset,
    pass,
    referenceId,
    receiverOnlyBody,
    colorMap,
  ]);
  return <g fill="none" dangerouslySetInnerHTML={{ __html: markup }} />;
});

export function Illustration({
  scene,
  assets,
  sources,
  prefix = "preview",
}: AssetSources & { scene: Scene; prefix?: string }) {
  const { customShadows } = useShadowFeatures();
  const split = needsShadowPass(scene, assets, customShadows);
  const entries = supportOrder(scene.elements)
    .filter((e) => !e.hidden)
    .flatMap((element) => {
      const asset = assets.find(
        (a) =>
          a.family === element.family &&
          a.detail === scene.detail &&
          a.role === element.role,
      );
      return asset && sources[asset.id]
        ? [
            {
              element,
              asset,
              shadow: effectiveShadow(scene, element, asset, customShadows),
            },
          ]
        : [];
    });
  const ids = new Set(entries.map((entry) => entry.element.id));
  const supports = new Map(
    entries.map(({ element }) => [
      element.id,
      (element.support_ids ?? []).filter((id) => ids.has(id)),
    ]),
  );
  const receivers = new Map(
    entries.map(({ element }, index) => [
      element.id,
      split
        ? supports.get(element.id)!.length
          ? supports.get(element.id)!
          : entries.slice(0, index).map(({ element: lower }) => lower.id)
        : [],
    ]),
  );
  const contacts = entries.some(
    ({ element }) => receivers.get(element.id)!.length > 0,
  );
  const [width, height] = FORMATS[scene.format];
  const bounds = (asset: Asset) => ({
    x: -asset.width * 3,
    y: -asset.height * 3,
    width: asset.width * 7,
    height: asset.height * 7,
  });
  const receiverMasks = contacts
    ? entries.flatMap(({ element: caster }, index) => {
        const supports = new Set(receivers.get(caster.id));
        if (!supports.size) return [];
        return (
          <mask
            key={caster.id}
            id={`${prefix}-receivers-${caster.id}`}
            maskUnits="userSpaceOnUse"
            mask-type="luminance"
            x="0"
            y="0"
            width={width}
            height={height}
          >
            {entries.slice(0, index).map(({ element: receiver, asset }) => {
              const allowed = supports.has(receiver.id);
              return (
                <g
                  key={receiver.id}
                  transform={elementTransform(scene, receiver)}
                  data-receiver-body={receiver.id}
                  data-receiver-fill={allowed ? "allow" : "cut"}
                >
                  <rect
                    {...bounds(asset)}
                    fill={allowed ? "white" : "black"}
                    mask={`url(#${prefix}-body-alpha-${receiver.id})`}
                  />
                </g>
              );
            })}
          </mask>
        );
      })
    : [];
  return (
    <>
      {!scene.transparent && (
        <rect
          data-background="true"
          width={width}
          height={height}
          fill={scene.palette.background[0]}
        />
      )}
      <defs>
        <clipPath id={`${prefix}-clip`}>
          <rect width={width} height={height} />
        </clipPath>
        {contacts &&
          entries.map(({ element, asset }) => (
            <mask
              key={element.id}
              {...bounds(asset)}
              id={`${prefix}-body-alpha-${element.id}`}
              maskUnits="userSpaceOnUse"
              mask-type="alpha"
              data-body-alpha={element.id}
            >
              <use href={`#${prefix}-body-${element.id}`} />
            </mask>
          ))}
        {receiverMasks}
      </defs>
      <g clipPath={`url(#${prefix}-clip)`}>
        {split && (
          <g data-scene-shadows="true">
            {entries.map(({ element, asset, shadow }) => {
              const painted = (
                <g
                  key={element.id}
                  data-shadow-owner-id={element.id}
                  transform={elementTransform(scene, element)}
                >
                  <Artwork
                    source={sources[asset.id]}
                    palette={scene.palette}
                    colorMap={element.color_map}
                    id={`${prefix}-${element.id}-cast`}
                    shadow={shadow}
                    asset={asset}
                    pass="shadow"
                    receiverOnlyBody={supports.get(element.id)!.length > 0}
                    referenceId={
                      contacts ? `${prefix}-cast-${element.id}` : undefined
                    }
                  />
                </g>
              );
              return supports.get(element.id)!.length ? (
                <defs
                  key={element.id}
                  data-supported-shadow-source={element.id}
                >
                  {painted}
                </defs>
              ) : (
                painted
              );
            })}
          </g>
        )}
        {entries.map(({ element, asset, shadow }) => (
          <Fragment key={element.id}>
            {contacts && receivers.get(element.id)!.length > 0 && (
              <g
                data-contact-shadow-owner={element.id}
                data-contact-shadow-receivers={receivers
                  .get(element.id)!
                  .join(" ")}
                pointerEvents="none"
                mask={`url(#${prefix}-receivers-${element.id})`}
              >
                <g transform={elementTransform(scene, element)}>
                  <use href={`#${prefix}-cast-${element.id}`} />
                </g>
              </g>
            )}
            <g
              data-element-id={element.id}
              data-family={element.family}
              data-source-node={asset.source_node_id}
              transform={elementTransform(scene, element)}
            >
              <Artwork
                source={sources[asset.id]}
                palette={scene.palette}
                colorMap={element.color_map}
                id={`${prefix}-${element.id}`}
                shadow={shadow}
                asset={asset}
                pass={split ? "body" : "all"}
                receiverOnlyBody={supports.get(element.id)!.length > 0}
                referenceId={
                  contacts ? `${prefix}-body-${element.id}` : undefined
                }
              />
            </g>
          </Fragment>
        ))}
      </g>
    </>
  );
}
