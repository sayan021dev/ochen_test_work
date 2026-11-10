export type Family =
  | "book"
  | "phone"
  | "puzzle"
  | "coin"
  | "headphones"
  | "lamp"
  | "flowers"
  | "wallet"
  | "folder"
  | "pen";
export type Detail = "L" | "S";
export type Shadow = { angle: number; length: number; opacity: number };
export type ShadowMetadata = {
  source_sha256: string;
  body_path_ids: string[];
  anchor: [number, number];
  width: number;
  height: number;
  outline: number;
  preserve_above?: number;
  hull?: [number, number][];
  erase_path_ids?: string[];
  sidewall?: [number, number, number, number, number];
};
export type Format = "square" | "landscape" | "portrait";
export type Palette = {
  id: string;
  name: string;
  background: string[];
  object: string[];
};
export type Element = {
  id: string;
  family: Family;
  role: "main" | "background";
  x: number;
  y: number;
  angle: number;
  hidden: boolean;
  locked: boolean;
  shadow?: Shadow | null;
};
export type Scene = {
  version: 1;
  title: string;
  format: Format;
  detail: Detail;
  scale: number;
  palette: Palette;
  transparent: boolean;
  elements: Element[];
};
export type Asset = {
  id: string;
  family: Family;
  name: string;
  detail: Detail;
  role: Element["role"];
  width: number;
  height: number;
  url: string;
  source_node_id: string;
  sha256: string;
  shadow: ShadowMetadata;
};
export type Bootstrap = {
  csrf_token: string;
  assets: Asset[];
  palettes: Palette[];
  formats: Record<Format, [number, number]>;
  ai: { configured: boolean; model: string };
};
export type Project = {
  id: string;
  scene: Scene;
  revision: number;
  updated_at: string;
};
export type Composition = {
  scenes: Scene[];
  explanation: string;
  provider: "components" | "dictionary" | "openai";
  model: string | null;
};
export const FORMATS: Record<Format, [number, number]> = {
  square: [1000, 1000],
  landscape: [1200, 630],
  portrait: [800, 1200],
};
