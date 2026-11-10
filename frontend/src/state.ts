import { createStore } from "zustand/vanilla";
import type {
  Asset,
  Detail,
  Element,
  Format,
  Palette,
  Scene,
  SceneLight,
} from "./types";
import { centerForFormat } from "./geometry";
import { cleanSupports, supportOrder } from "./support";

export function defaultScene(palette: Palette): Scene {
  return {
    version: 1,
    title: "Тихое место для больших идей",
    format: "landscape",
    detail: "L",
    scale: 0.36,
    palette,
    transparent: false,
    elements: [
      {
        id: "starter-book",
        family: "book",
        role: "main",
        x: 90,
        y: 185,
        angle: 0,
        hidden: false,
        locked: false,
      },
      {
        id: "starter-headphones",
        family: "headphones",
        role: "background",
        x: 470,
        y: 325,
        angle: 0,
        hidden: false,
        locked: false,
      },
      {
        id: "starter-lamp",
        family: "lamp",
        role: "main",
        x: 735,
        y: 75,
        angle: 0,
        hidden: false,
        locked: false,
      },
    ],
  };
}

type EditorState = {
  scene: Scene;
  selected: string | null;
  selectedPart: "object" | "shadow";
  past: Scene[];
  future: Scene[];
  dragBaseline: Scene | null;
  projectId: string | null;
  serverRevision: number;
  changeVersion: number;
  savedVersion: number;
  documentEpoch: number;
  clipboard: Element | null;
  copySelection: () => void;
  pasteSelection: () => void;
  setFormat: (
    format: Format,
    assets: Asset[],
    customShadowsEnabled?: boolean,
  ) => void;
  previewLight: (light: SceneLight) => void;
  previewElement: (id: string, patch: Partial<Element>) => void;
  change: (scene: Scene) => void;
  select: (id: string | null) => void;
  selectShadow: (id: string) => void;
  detachProject: () => void;
  patchElement: (id: string, patch: Partial<Element>) => void;
  add: (family: Element["family"]) => void;
  duplicate: () => void;
  remove: () => void;
  reorder: (id: string, delta: number) => void;
  undo: () => void;
  redo: () => void;
  setDetail: (detail: Detail) => void;
  beginDrag: () => void;
  previewMove: (id: string, x: number, y: number) => void;
  finishDrag: () => void;
  cancelDrag: () => void;
  hydrate: (scene: Scene, id?: string, revision?: number) => void;
  importScene: (scene: Scene) => void;
  saved: (id: string, revision: number, version: number) => void;
};
const same = (a: Scene, b: Scene) => JSON.stringify(a) === JSON.stringify(b);
const bounded = (value: number) =>
  Math.max(-5000, Math.min(5000, Math.round(value * 100) / 100));

export function createEditorStore(initial: Scene) {
  return createStore<EditorState>((set, get) => ({
    scene: {
      ...initial,
      elements: supportOrder(cleanSupports(initial.elements)),
    },
    selected: null,
    selectedPart: "object",
    past: [],
    future: [],
    dragBaseline: null,
    projectId: null,
    serverRevision: 0,
    changeVersion: 0,
    savedVersion: 0,
    documentEpoch: 0,
    clipboard: null,
    detachProject: () =>
      set((s) => ({
        projectId: null,
        serverRevision: 0,
        savedVersion: -1,
        documentEpoch: s.documentEpoch + 1,
      })),
    copySelection: () => {
      const e = get().scene.elements.find((e) => e.id === get().selected);
      if (e) set({ clipboard: structuredClone(e) });
    },
    pasteSelection: () => {
      const s = get();
      if (!s.clipboard || s.scene.elements.length >= 48) return;
      const element = {
        ...structuredClone(s.clipboard),
        id: crypto.randomUUID(),
        x: bounded(s.clipboard.x + 24),
        y: bounded(s.clipboard.y + 24),
        hidden: false,
        locked: false,
      };
      s.change({ ...s.scene, elements: [...s.scene.elements, element] });
      set({
        selected: element.id,
        selectedPart: "object",
        clipboard: structuredClone(element),
      });
    },
    setFormat: (format, assets, customShadowsEnabled = true) =>
      get().change(
        centerForFormat(get().scene, format, assets, customShadowsEnabled),
      ),
    previewLight: (light) => set((s) => ({ scene: { ...s.scene, light } })),
    previewElement: (id, patch) =>
      set((s) => ({
        scene: {
          ...s.scene,
          elements: s.scene.elements.map((e) =>
            e.id === id && !e.locked ? { ...e, ...patch } : e,
          ),
        },
      })),
    change: (scene) => {
      const normalized = {
        ...scene,
        elements: supportOrder(cleanSupports(scene.elements)),
      };
      set((s) =>
        same(normalized, s.scene)
          ? {}
          : {
              scene: normalized,
              past: [...s.past, s.scene].slice(-50),
              future: [],
              changeVersion: s.changeVersion + 1,
            },
      );
    },
    select: (selected) => set({ selected, selectedPart: "object" }),
    selectShadow: (selected) => {
      const e = get().scene.elements.find((e) => e.id === selected);
      if (e?.shadow && !e.hidden) set({ selected, selectedPart: "shadow" });
    },
    patchElement: (id, patch) =>
      get().change({
        ...get().scene,
        elements: get().scene.elements.map((e) =>
          e.id === id ? { ...e, ...patch } : e,
        ),
      }),
    add: (family) => {
      const s = get();
      if (s.scene.elements.length >= 48) return;
      const id = crypto.randomUUID();
      s.change({
        ...s.scene,
        elements: [
          ...s.scene.elements,
          {
            id,
            family,
            role: "main",
            x: 100,
            y: 100,
            angle: 0,
            hidden: false,
            locked: false,
          },
        ],
      });
      set({ selected: id, selectedPart: "object" });
    },
    duplicate: () => {
      const s = get(),
        original = s.scene.elements.find((e) => e.id === s.selected);
      if (!original || s.scene.elements.length >= 48) return;
      const id = crypto.randomUUID();
      s.change({
        ...s.scene,
        elements: [
          ...s.scene.elements,
          {
            ...original,
            id,
            x: bounded(original.x + 24),
            y: bounded(original.y + 24),
            locked: false,
          },
        ],
      });
      set({ selected: id, selectedPart: "object" });
    },
    remove: () => {
      const s = get(),
        selected = s.scene.elements.find((e) => e.id === s.selected);
      if (!selected || selected.locked) return;
      if (s.selectedPart === "shadow" && selected.shadow) {
        s.patchElement(selected.id, { shadow: null });
        set({ selectedPart: "object" });
        return;
      }
      s.change({
        ...s.scene,
        elements: s.scene.elements.filter((e) => e.id !== s.selected),
      });
      set({ selected: null, selectedPart: "object" });
    },
    reorder: (id, delta) => {
      const s = get(),
        index = s.scene.elements.findIndex((e) => e.id === id),
        next = index + delta;
      if (index < 0 || next < 0 || next >= s.scene.elements.length) return;
      const elements = [...s.scene.elements];
      [elements[index], elements[next]] = [elements[next], elements[index]];
      const positions = new Map(elements.map((e, i) => [e.id, i]));
      s.change({
        ...s.scene,
        elements: elements.map((e) =>
          e.support_ids
            ? {
                ...e,
                support_ids: e.support_ids.filter(
                  (id) => positions.get(id)! < positions.get(e.id)!,
                ),
              }
            : e,
        ),
      });
    },
    undo: () =>
      set((s) =>
        s.past.length
          ? {
              scene: s.past.at(-1)!,
              past: s.past.slice(0, -1),
              future: [s.scene, ...s.future],
              selected: null,
              selectedPart: "object",
              changeVersion: s.changeVersion + 1,
            }
          : {},
      ),
    redo: () =>
      set((s) =>
        s.future.length
          ? {
              scene: s.future[0],
              future: s.future.slice(1),
              past: [...s.past, s.scene],
              selected: null,
              selectedPart: "object",
              changeVersion: s.changeVersion + 1,
            }
          : {},
      ),
    setDetail: (detail) => {
      const s = get();
      if (s.scene.detail !== detail)
        s.change({
          ...s.scene,
          detail,
          elements: s.scene.elements.map((e) =>
            e.shadow
              ? {
                  ...e,
                  shadow: {
                    ...e.shadow,
                    x: bounded((e.shadow.x ?? 0) * (detail === "S" ? 0.5 : 2)),
                    y: bounded((e.shadow.y ?? 0) * (detail === "S" ? 0.5 : 2)),
                  },
                }
              : e,
          ),
          scale: Math.max(
            0.03,
            Math.min(8, s.scene.scale * (detail === "S" ? 2 : 0.5)),
          ),
        });
    },
    beginDrag: () => set({ dragBaseline: get().scene }),
    previewMove: (id, x, y) =>
      set((s) => ({
        scene: {
          ...s.scene,
          elements: s.scene.elements.map((e) =>
            e.id === id && !e.locked
              ? { ...e, x: bounded(x), y: bounded(y) }
              : e,
          ),
        },
      })),
    finishDrag: () =>
      set((s) =>
        s.dragBaseline && !same(s.dragBaseline, s.scene)
          ? {
              past: [...s.past, s.dragBaseline].slice(-50),
              future: [],
              dragBaseline: null,
              changeVersion: s.changeVersion + 1,
            }
          : { dragBaseline: null },
      ),
    cancelDrag: () =>
      set((s) => ({ scene: s.dragBaseline ?? s.scene, dragBaseline: null })),
    hydrate: (scene, id, revision) =>
      set((s) => ({
        scene: {
          ...scene,
          elements: supportOrder(cleanSupports(scene.elements)),
        },
        selected: null,
        selectedPart: "object",
        past: [],
        future: [],
        dragBaseline: null,
        projectId: id ?? null,
        serverRevision: revision ?? 0,
        changeVersion: 0,
        savedVersion: 0,
        documentEpoch: s.documentEpoch + 1,
      })),
    importScene: (scene) => {
      get().hydrate(scene);
      set({ changeVersion: 1, savedVersion: 0 });
    },
    saved: (id, revision, version) =>
      set({ projectId: id, serverRevision: revision, savedVersion: version }),
  }));
}
