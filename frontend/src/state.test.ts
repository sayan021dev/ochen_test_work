import { describe, expect, it } from "vitest";
import { createEditorStore, defaultScene } from "./state";
import type { Palette } from "./types";

const palette: Palette = {
  id: "test",
  name: "Test",
  background: ["#D7CDF5", "#AA9BF0", "#7864D7", "#181817"],
  object: ["#F9ECB0", "#F9A3AA", "#FFE3E1", "#FFFFFF"],
};

describe("editor regressions", () => {
  it("imported scenes become a new unsaved document even when content is identical", () => {
    const store = createEditorStore(defaultScene(palette));
    store.getState().hydrate(store.getState().scene, "old-project", 9);
    const epoch = store.getState().documentEpoch;
    store.getState().importScene(store.getState().scene);
    expect(store.getState().projectId).toBeNull();
    expect(store.getState().documentEpoch).toBeGreaterThan(epoch);
    expect(store.getState().changeVersion).not.toBe(
      store.getState().savedVersion,
    );
  });
  it("duplicates with a new instance ID, then undo/redo restores content and order", () => {
    const store = createEditorStore(defaultScene(palette));
    const first = store.getState().scene.elements[0];
    store.getState().select(first.id);
    store.getState().duplicate();
    expect(store.getState().scene.elements).toHaveLength(4);
    expect(new Set(store.getState().scene.elements.map((e) => e.id)).size).toBe(
      4,
    );
    store.getState().undo();
    expect(store.getState().scene.elements).toHaveLength(3);
    store.getState().redo();
    expect(store.getState().scene.elements).toHaveLength(4);
  });
  it("a drag creates one history entry, cancel restores without history", () => {
    const store = createEditorStore(defaultScene(palette));
    const first = store.getState().scene.elements[0];
    store.getState().beginDrag();
    store.getState().previewMove(first.id, 101, 202);
    store.getState().previewMove(first.id, 103, 204);
    store.getState().finishDrag();
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().scene.elements[0]).toEqual(first);
    store.getState().beginDrag();
    store.getState().previewMove(first.id, 800, 400);
    store.getState().cancelDrag();
    expect(store.getState().scene.elements[0]).toEqual(first);
  });
  it("detail swaps actual variants while maintaining scene anchors and relative scale", () => {
    const store = createEditorStore(defaultScene(palette));
    const before = store.getState().scene;
    store.getState().setDetail("S");
    const after = store.getState().scene;
    expect(after.detail).toBe("S");
    expect(after.scale).toBeCloseTo(before.scale * 2);
    expect(after.elements).toEqual(before.elements);
    store.getState().setDetail("L");
    expect(store.getState().scene.scale).toBeCloseTo(before.scale);
  });
  it("late save acknowledges its snapshot without erasing newer edits", () => {
    const store = createEditorStore(defaultScene(palette));
    store.getState().change({ ...store.getState().scene, title: "First" });
    const savedVersion = store.getState().changeVersion;
    store.getState().change({ ...store.getState().scene, title: "Second" });
    store.getState().saved("project", 1, savedVersion);
    expect(store.getState().scene.title).toBe("Second");
    expect(store.getState().changeVersion).toBeGreaterThan(
      store.getState().savedVersion,
    );
  });
  it("locked objects cannot be moved or deleted; empty undo and new edits are safe", () => {
    const store = createEditorStore(defaultScene(palette));
    const first = store.getState().scene.elements[0];
    store.getState().select(first.id);
    store.getState().patchElement(first.id, { locked: true });
    store.getState().previewMove(first.id, 999, 999);
    store.getState().remove();
    expect(store.getState().scene.elements[0].x).toBe(first.x);
    expect(store.getState().scene.elements).toHaveLength(3);
    store.getState().undo();
    store.getState().undo();
    store.getState().redo();
    store.getState().change({ ...store.getState().scene, title: "New" });
    expect(store.getState().future).toHaveLength(0);
  });
});

it("optional shadow survives duplicate, role/detail changes and undo without modifying the original instance", () => {
  const store = createEditorStore(defaultScene(palette));
  const element = store.getState().scene.elements[0];
  store.getState().select(element.id);
  store
    .getState()
    .patchElement(element.id, {
      shadow: { angle: 140, length: 1.5, opacity: 0.6 },
    });
  store.getState().duplicate();
  const copy = store.getState().scene.elements.at(-1)!;
  expect(copy.shadow).toEqual({ angle: 140, length: 1.5, opacity: 0.6 });
  store
    .getState()
    .patchElement(copy.id, {
      shadow: { ...copy.shadow!, angle: 20 },
      role: "background",
    });
  store.getState().setDetail("S");
  expect(store.getState().scene.elements[0].shadow?.angle).toBe(140);
  expect(store.getState().scene.elements.at(-1)?.shadow?.angle).toBe(20);
  store.getState().undo();
  store.getState().undo();
  expect(store.getState().scene.elements.at(-1)?.shadow?.angle).toBe(140);
});
