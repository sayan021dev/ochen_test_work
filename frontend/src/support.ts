import type { Element } from "./types";

/** Stable Kahn order: choose the first ready item in the original layer order. */
export function supportOrder(elements: Element[]): Element[] {
  const ids = new Set(elements.map((e) => e.id));
  if (ids.size !== elements.length)
    throw new Error("ID экземпляров должны быть уникальными");
  for (const e of elements) {
    const supports = e.support_ids ?? [];
    if (
      new Set(supports).size !== supports.length ||
      supports.some((id) => id === e.id || !ids.has(id))
    )
      throw new Error("Некорректная опора объекта");
  }
  const pending = [...elements],
    ready = new Set<string>(),
    result: Element[] = [];
  while (pending.length) {
    const index = pending.findIndex((e) =>
      (e.support_ids ?? []).every((id) => ready.has(id)),
    );
    if (index < 0) throw new Error("Опоры не могут образовывать цикл");
    const [element] = pending.splice(index, 1);
    result.push(element);
    ready.add(element.id);
  }
  return result;
}
export function canSupport(
  elements: Element[],
  casterId: string,
  receiverId: string,
): boolean {
  if (casterId === receiverId || !elements.some((e) => e.id === receiverId))
    return false;
  try {
    supportOrder(
      elements.map((e) =>
        e.id === casterId ? { ...e, support_ids: [receiverId] } : e,
      ),
    );
    return elements.some((e) => e.id === casterId);
  } catch {
    return false;
  }
}
/** Deleting a receiver or pasting into another document drops dangling links. */
export function cleanSupports(elements: Element[]): Element[] {
  const ids = new Set(elements.map((e) => e.id));
  return elements.map((e) => {
    if (!e.support_ids) return e;
    const supports = e.support_ids.filter((id) => ids.has(id));
    return supports.length === e.support_ids.length
      ? e
      : { ...e, support_ids: supports };
  });
}
