import { expect, it } from "vitest";
import { createEditorStore, defaultScene } from "./state";
import { canSupport, supportOrder } from "./support";
import type { Scene } from "./types";
const palette = {
  id: "test",
  name: "Test",
  background: ["#D7CDF5", "#AA9BF0", "#7864D7", "#181817"],
  object: ["#F9ECB0", "#F9A3AA", "#FFE3E1", "#FFFFFF"],
};
function fixture(): Scene {
  const s = defaultScene(palette);
  s.elements = s.elements.map((e, i) => ({
    ...e,
    id: ["phone", "lamp", "pen"][i],
    family: (["phone", "lamp", "pen"] as const)[i],
    support_ids: i ? [i === 1 ? "phone" : "lamp"] : [],
  }));
  return s;
}
it("support order is stable and rejects cycles while manual options exclude descendants", () => {
  const [phone, lamp, pen] = fixture().elements;
  expect(supportOrder([pen, phone, lamp]).map((e) => e.id)).toEqual([
    "phone",
    "lamp",
    "pen",
  ]);
  expect(canSupport([phone, lamp, pen], "phone", "pen")).toBe(false);
  expect(canSupport([phone, lamp, pen], "pen", "phone")).toBe(true);
  expect(() =>
    supportOrder([{ ...phone, support_ids: ["pen"] }, lamp, pen]),
  ).toThrow();
});
it("deleting a receiver clears only its direct links and undo restores the full chain", () => {
  const store = createEditorStore(fixture());
  store.getState().select("lamp");
  store.getState().remove();
  expect(
    store.getState().scene.elements.find((e) => e.id === "pen")!.support_ids,
  ).toEqual([]);
  store.getState().undo();
  expect(store.getState().scene.elements.map((e) => e.support_ids)).toEqual([
    [],
    ["phone"],
    ["lamp"],
  ]);
});
it("duplicate and same-scene paste retain existing supports; cross-document paste drops dangling links", () => {
  const store = createEditorStore(fixture());
  store.getState().select("pen");
  store.getState().duplicate();
  expect(store.getState().scene.elements.at(-1)!.support_ids).toEqual(["lamp"]);
  store.getState().copySelection();
  store.getState().hydrate({ ...fixture(), elements: [fixture().elements[0]] });
  store.getState().pasteSelection();
  expect(store.getState().scene.elements.at(-1)!.support_ids).toEqual([]);
});
it("manual reordering detaches crossed support links, and detail/movement retain valid links", () => {
  const store = createEditorStore(fixture());
  store.getState().reorder("pen", -1);
  expect(store.getState().scene.elements.map((e) => e.id)).toEqual([
    "phone",
    "pen",
    "lamp",
  ]);
  expect(store.getState().scene.elements[1].support_ids).toEqual([]);
  store.getState().undo();
  store.getState().setDetail("S");
  store.getState().previewMove("pen", 250, 260);
  expect(
    store.getState().scene.elements.find((e) => e.id === "pen")!.support_ids,
  ).toEqual(["lamp"]);
});
it("a light drag is one undo step and cancellation restores settings without new history", () => {
  const store = createEditorStore(fixture());
  const light = { enabled: true, x: 100, y: 100, height: 1000, opacity: 0.35 };
  store.getState().change({ ...store.getState().scene, light });
  const before = store.getState().past.length;
  store.getState().beginDrag();
  store.getState().previewLight({ ...light, x: 200 });
  store.getState().previewLight({ ...light, x: 250 });
  store.getState().finishDrag();
  expect(store.getState().past.length).toBe(before + 1);
  store.getState().undo();
  expect(store.getState().scene.light).toEqual(light);
  store.getState().beginDrag();
  store.getState().previewLight({ ...light, y: 200 });
  store.getState().cancelDrag();
  expect(store.getState().scene.light).toEqual(light);
});
