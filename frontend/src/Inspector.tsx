import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FolderInput,
  Lock,
  Sun,
  Unlock,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { clampLightToCanvas, type EditorStore } from "./Canvas";
import { FORMATS, type Asset, type Palette } from "./types";
import { useShadowFeatures } from "./features";
import { canSupport } from "./support";
import { rotateElement } from "./geometry";

function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
  disabled = false,
  onStep,
  onStepStart,
  onStepEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
  onStep?: (delta: number) => void;
  onStepStart?: () => void;
  onStepEnd?: () => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const callbacks = useRef({ onStep, onStepEnd });
  useEffect(() => {
    callbacks.current = { onStep, onStepEnd };
  }, [onStep, onStepEnd]);
  const stop = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (holding.current) {
      holding.current = false;
      callbacks.current.onStepEnd?.();
    }
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (holding.current) callbacks.current.onStepEnd?.();
    },
    [],
  );
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  return (
    <div className="number-field">
      <span>
        {label === "Положение X" ? "X" : label === "Положение Y" ? "Y" : "↻"}
      </span>
      <input
        aria-label={label}
        type="number"
        disabled={disabled}
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (draft.trim() && Number.isFinite(n)) {
            const actual = Math.min(max, Math.max(min, n));
            setDraft(String(actual));
            onCommit(actual);
          } else setDraft(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {label === "Угол поворота" && <span>°</span>}
      {onStep && (
        <span className="angle-steppers">
          {([1, -1] as const).map((delta) => (
            <button
              key={delta}
              type="button"
              disabled={disabled}
              aria-label={`${delta === 1 ? "Увеличить" : "Уменьшить"} ${label === "Направление тени" ? "угол тени" : "угол поворота"}`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                stop();
                holding.current = true;
                onStepStart?.();
                onStep(delta);
                const repeat = () => {
                  callbacks.current.onStep?.(delta);
                  timer.current = setTimeout(repeat, 60);
                };
                timer.current = setTimeout(repeat, 350);
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerUp={stop}
              onPointerCancel={stop}
              onLostPointerCapture={stop}
              onClick={(event) => {
                if (event.detail === 0) {
                  onStepStart?.();
                  onStep(delta);
                  onStepEnd?.();
                }
              }}
            >
              {delta === 1 ? (
                <ChevronUp size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

export function Inspector({
  store,
  assets,
  palettes,
  onImportPalette,
  onClose,
}: {
  store: EditorStore;
  assets: Asset[];
  palettes: Palette[];
  onImportPalette: () => void;
  onClose: () => void;
}) {
  const state = useStore(store),
    { scene, selected } = state;
  const { customShadows } = useShadowFeatures();
  const globalLight = customShadows && !!scene.light?.enabled;
  const [canvasWidth, canvasHeight] = FORMATS[scene.format];
  const lightOutside =
    !!scene.light &&
    (scene.light.x < 0 ||
      scene.light.x > canvasWidth ||
      scene.light.y < 0 ||
      scene.light.y > canvasHeight);

  const element = scene.elements.find((e) => e.id === selected);
  const asset = element
    ? assets.find(
        (a) =>
          a.family === element.family &&
          a.detail === scene.detail &&
          a.role === element.role,
      )
    : null;
  return (
    <aside
      className="inspector"
      id="settings-panel"
      aria-label="Настройки композиции"
    >
      <div className="panel-heading">
        <h2>
          {element
            ? state.selectedPart === "shadow" && customShadows && !globalLight
              ? "Тень объекта"
              : "Объект"
            : "Композиция"}
        </h2>
        <button
          className="icon mobile-only"
          aria-label="Закрыть настройки"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {!element && customShadows && (
        <section
          className="inspector-section scene-light-settings"
          aria-label="Источник света композиции"
        >
          <label className="shadow-toggle">
            <input
              type="checkbox"
              aria-label="Общий источник света"
              checked={!!scene.light?.enabled}
              onChange={(event) => {
                const [width, height] = FORMATS[scene.format];
                state.change({
                  ...scene,
                  light: {
                    x: width * 0.2,
                    y: height * 0.15,
                    height: Math.min(
                      5000,
                      Math.max(1000, Math.max(width, height) * 1.5),
                    ),
                    opacity: 0.35,
                    ...scene.light,
                    enabled: event.target.checked,
                  },
                });
              }}
            />
            <span>
              <strong>Общий источник света</strong>
              <small>Экспериментальный режим</small>
            </span>
            <Sun size={18} />
          </label>
          <p className="help-text">
            Перемещайте источник на холсте. Он управляет тенями всех предметов;
            исходные блики сохраняются.
          </p>
          {scene.light?.enabled && (
            <div className="shadow-fields">
              <label>
                <span className="field-label">Высота источника</span>
                <NumberField
                  label="Высота источника"
                  value={scene.light.height}
                  min={50}
                  max={5000}
                  onCommit={(height) =>
                    state.change({
                      ...scene,
                      light: { ...scene.light!, height },
                    })
                  }
                />
              </label>
              <label>
                <span className="field-label">Плотность теней, %</span>
                <NumberField
                  label="Плотность теней"
                  value={scene.light.opacity * 100}
                  min={0}
                  max={100}
                  onCommit={(opacity) =>
                    state.change({
                      ...scene,
                      light: { ...scene.light!, opacity: opacity / 100 },
                    })
                  }
                />
              </label>
              <button
                className="secondary light-focus"
                onClick={() => {
                  const marker = document.querySelector<SVGElement>(
                    "[data-light-marker]",
                  );
                  if (lightOutside && scene.light) {
                    const matrix = marker?.ownerSVGElement?.getScreenCTM();
                    const camera = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
                    state.change({
                      ...scene,
                      light: {
                        ...scene.light,
                        ...clampLightToCanvas(
                          scene.light,
                          canvasWidth,
                          canvasHeight,
                          camera,
                        ),
                      },
                    });
                    requestAnimationFrame(() =>
                      document
                        .querySelector<SVGElement>("[data-light-marker]")
                        ?.focus(),
                    );
                  } else marker?.focus();
                }}
              >
                {lightOutside
                  ? "Вернуть источник на холст"
                  : "Выбрать источник на холсте"}
              </button>
            </div>
          )}
        </section>
      )}
      {element && asset && (
        <section className="inspector-section object-settings">
          <div className="selected-object">
            <img src={asset.url} alt="" />
            <div>
              <strong>{asset.name}</strong>
              <small>Исходный SVG · {scene.detail}</small>
            </div>
            <button
              className="icon"
              aria-label="Снять выделение"
              onClick={() => state.select(null)}
            >
              <X size={15} />
            </button>
          </div>
          <span className="field-label">РОЛЬ В КОМПОЗИЦИИ</span>
          <div className="segmented">
            <button
              aria-pressed={element.role === "main"}
              onClick={() => state.patchElement(element.id, { role: "main" })}
            >
              Главный
            </button>
            <button
              aria-pressed={element.role === "background"}
              onClick={() =>
                state.patchElement(element.id, { role: "background" })
              }
            >
              Фоновый
            </button>
          </div>
          <label className="receiver-field">
            <span className="field-label">Опора</span>
            <select
              aria-label="Опора"
              disabled={element.locked}
              value={
                (element.support_ids?.length ?? 0) > 1
                  ? ":multiple"
                  : (element.support_ids?.[0] ?? "")
              }
              onChange={(event) =>
                state.patchElement(element.id, {
                  support_ids: event.target.value ? [event.target.value] : [],
                })
              }
            >
              <option value="">Без опоры</option>
              {(element.support_ids?.length ?? 0) > 1 && (
                <option value=":multiple" disabled>
                  Несколько опор
                </option>
              )}
              {scene.elements
                .filter((candidate) =>
                  canSupport(scene.elements, element.id, candidate.id),
                )
                .map((candidate) => {
                  const item = assets.find(
                    (a) =>
                      a.family === candidate.family &&
                      a.detail === scene.detail &&
                      a.role === candidate.role,
                  );
                  const duplicate =
                    scene.elements.filter((e) => e.family === candidate.family)
                      .length > 1;
                  return (
                    <option key={candidate.id} value={candidate.id}>
                      {item?.name ?? candidate.family}
                      {duplicate
                        ? ` · ${scene.elements.indexOf(candidate) + 1}`
                        : ""}
                    </option>
                  );
                })}
            </select>
          </label>
          {globalLight && (
            <div className="active-light-note">
              <Sun size={16} />
              <span>Тенями управляет общий свет.</span>
              <button
                className="text-button"
                onClick={() => state.select(null)}
              >
                Настроить свет
              </button>
            </div>
          )}
          {customShadows && !globalLight && (
            <div className="shadow-settings">
              <label className="shadow-toggle">
                <input
                  type="checkbox"
                  aria-label="Своя тень"
                  checked={!!element.shadow}
                  disabled={element.locked}
                  onChange={(event) => {
                    state.patchElement(element.id, {
                      shadow: event.target.checked
                        ? { angle: 90, length: 1, opacity: 1 }
                        : null,
                    });
                    if (!event.target.checked) state.select(element.id);
                  }}
                />
                <span>
                  <strong>Своя тень</strong>
                  <small>Дополнительный режим</small>
                </span>
                <span className="outline-pill">β</span>
              </label>
              {element.shadow ? (
                <>
                  <p className="shadow-hint">
                    <span>
                      Силуэт предмета проецируется от неподвижной опоры.
                    </span>
                    <span>100% — стандартная длина проекции.</span>
                  </p>
                  <button
                    className="secondary shadow-select"
                    disabled={element.locked}
                    onClick={() => state.selectShadow(element.id)}
                  >
                    Выделить тень на холсте
                  </button>
                  <div className="shadow-fields">
                    <div>
                      <span className="field-label">
                        Направление проекции, °
                      </span>
                      <NumberField
                        label="Направление тени"
                        value={element.shadow.angle}
                        min={0}
                        max={360}
                        disabled={element.locked}
                        onStepStart={state.beginDrag}
                        onStepEnd={state.finishDrag}
                        onStep={(delta) => {
                          const current = store
                            .getState()
                            .scene.elements.find((e) => e.id === element.id);
                          if (current?.shadow)
                            store.getState().previewElement(element.id, {
                              shadow: {
                                ...current.shadow,
                                angle:
                                  (current.shadow.angle + delta + 360) % 360,
                                x: 0,
                                y: 0,
                                scale_x: 1,
                                scale_y: 1,
                              },
                            });
                        }}
                        onCommit={(angle) =>
                          !element.locked &&
                          state.patchElement(element.id, {
                            shadow: {
                              ...element.shadow!,
                              angle,
                              x: 0,
                              y: 0,
                              scale_x: 1,
                              scale_y: 1,
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <span className="field-label">Длина, %</span>
                      <NumberField
                        label="Длина тени"
                        value={element.shadow.length * 100}
                        min={0}
                        max={200}
                        disabled={element.locked}
                        onCommit={(length) =>
                          !element.locked &&
                          state.patchElement(element.id, {
                            shadow: {
                              ...element.shadow!,
                              length: length / 100,
                              x: 0,
                              y: 0,
                              scale_x: 1,
                              scale_y: 1,
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <span className="field-label">Непрозрачность, %</span>
                      <NumberField
                        label="Непрозрачность тени"
                        value={element.shadow.opacity * 100}
                        min={0}
                        max={100}
                        disabled={element.locked}
                        onCommit={(opacity) =>
                          !element.locked &&
                          state.patchElement(element.id, {
                            shadow: {
                              ...element.shadow!,
                              opacity: opacity / 100,
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="shadow-presets" aria-label="Направления тени">
                    {[
                      [45, "Вправо вниз"],
                      [135, "Влево вниз"],
                      [225, "Влево вверх"],
                      [315, "Вправо вверх"],
                    ].map(([angle, name]) => (
                      <button
                        key={angle}
                        disabled={element.locked}
                        aria-label={`Тень: ${name}`}
                        title={String(name)}
                        onClick={() =>
                          state.patchElement(element.id, {
                            shadow: {
                              ...element.shadow!,
                              angle: Number(angle),
                              x: 0,
                              y: 0,
                              scale_x: 1,
                              scale_y: 1,
                            },
                          })
                        }
                      >
                        <span style={{ transform: `rotate(${angle}deg)` }}>
                          →
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="shadow-hint">
                  Сейчас используется исходная тень из библиотеки.
                </p>
              )}
            </div>
          )}
          <span className="field-label">ПОЛОЖЕНИЕ И ПОВОРОТ ПРЕДМЕТА</span>
          <div className="position-grid">
            <NumberField
              label="Положение X"
              value={element.x}
              min={-5000}
              max={5000}
              onCommit={(x) =>
                !element.locked && state.patchElement(element.id, { x })
              }
            />
            <NumberField
              label="Положение Y"
              value={element.y}
              min={-5000}
              max={5000}
              onCommit={(y) =>
                !element.locked && state.patchElement(element.id, { y })
              }
            />
            <NumberField
              label="Угол поворота"
              disabled={element.locked}
              value={element.angle}
              min={-360}
              max={360}
              onStepStart={state.beginDrag}
              onStepEnd={state.finishDrag}
              onStep={(delta) => {
                const current = store
                  .getState()
                  .scene.elements.find((e) => e.id === element.id);
                if (current)
                  store
                    .getState()
                    .previewElement(
                      element.id,
                      rotateElement(
                        current,
                        store.getState().scene.scale,
                        asset.width,
                        asset.height,
                        current.angle + delta,
                      ),
                    );
              }}
              onCommit={(angle) =>
                !element.locked &&
                state.patchElement(
                  element.id,
                  rotateElement(
                    element,
                    scene.scale,
                    asset.width,
                    asset.height,
                    angle,
                  ),
                )
              }
            />
          </div>
        </section>
      )}
      <section className="inspector-section">
        <h3>Детализация</h3>
        <p className="help-text">Два исходных набора для разных размеров</p>
        <div className="segmented detail-control">
          {(["S", "L"] as const).map((detail) => (
            <button
              key={detail}
              aria-label={`Детализация ${detail}`}
              aria-pressed={scene.detail === detail}
              onClick={() => state.setDetail(detail)}
            >
              <strong>{detail}</strong>
              <small>{detail === "S" ? "Компактная" : "Подробная"}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="inspector-section palette-section">
        <div className="section-title">
          <h3>Цветовая схема</h3>
          <span className="tiny-label">{scene.palette.name}</span>
        </div>
        <div className="palettes">
          {palettes.map((p) => (
            <button
              key={p.id}
              aria-label={`Палитра ${p.name}`}
              aria-pressed={scene.palette.id === p.id}
              className="palette-option"
              onClick={() => state.change({ ...scene, palette: p })}
            >
              <span className="swatches">
                {[...p.background.slice(0, 3), ...p.object.slice(0, 2)].map(
                  (c, i) => (
                    <i key={i} style={{ background: c }} />
                  ),
                )}
              </span>
              <span>{p.name}</span>
              <span className="radio-indicator" />
            </button>
          ))}
        </div>
        <button
          className="text-button import-palette"
          onClick={onImportPalette}
        >
          <FolderInput size={14} />
          Загрузить палитру
        </button>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={scene.transparent}
            onChange={(e) =>
              state.change({ ...scene, transparent: e.target.checked })
            }
          />
          Прозрачный фон
        </label>
      </section>
      <section className="inspector-section layers-section">
        <div className="section-title">
          <h3>Слои</h3>
          <span className="count">{scene.elements.length}</span>
        </div>
        <div className="layer-list">
          {[...scene.elements].reverse().map((e) => {
            const a = assets.find(
              (a) =>
                a.family === e.family &&
                a.detail === scene.detail &&
                a.role === e.role,
            )!;
            return (
              <div
                key={e.id}
                className={`layer-row ${selected === e.id ? "selected" : ""}`}
              >
                <button
                  className="layer-select"
                  aria-label={`Слой ${a.name}`}
                  aria-pressed={selected === e.id}
                  onClick={() => state.select(e.id)}
                >
                  <img src={a.url} alt="" />
                  <span>
                    {a.name}
                    <small>{e.role === "main" ? "Главный" : "Фоновый"}</small>
                  </span>
                </button>
                <button
                  className="icon compact"
                  aria-label={`${e.hidden ? "Показать" : "Скрыть"} ${a.name}`}
                  onClick={() =>
                    state.patchElement(e.id, { hidden: !e.hidden })
                  }
                >
                  {e.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button
                  className="icon compact lock-button"
                  aria-label={`${e.locked ? "Разблокировать" : "Зафиксировать"} ${a.name}`}
                  onClick={() =>
                    state.patchElement(e.id, { locked: !e.locked })
                  }
                >
                  {e.locked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
              </div>
            );
          })}
        </div>
        {!scene.elements.length && (
          <p className="help-text">Добавьте предмет из библиотеки слева.</p>
        )}
      </section>
    </aside>
  );
}
