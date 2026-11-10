import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FolderInput,
  Lock,
  Unlock,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { EditorStore } from "./Canvas";
import type { Asset, Palette } from "./types";
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
            ? state.selectedPart === "shadow"
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
                      ? { angle: 0, length: 1, opacity: 1 }
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
                    Тень закреплена у предмета. Меняйте направление и длину.
                  </span>
                  <span>100% — исходная длина.</span>
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
                      Поворот исходной тени, °
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
                              angle: (current.shadow.angle + delta + 360) % 360,
                            },
                          });
                      }}
                      onCommit={(angle) =>
                        !element.locked &&
                        state.patchElement(element.id, {
                          shadow: { ...element.shadow!, angle },
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
                          shadow: { ...element.shadow!, length: length / 100 },
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
                    [0, "Исходное направление"],
                    [90, "Поворот на 90°"],
                    [180, "Поворот на 180°"],
                    [270, "Поворот на 270°"],
                  ].map(([angle, name]) => (
                    <button
                      key={angle}
                      disabled={element.locked}
                      aria-label={`Тень: ${name}`}
                      title={String(name)}
                      onClick={() =>
                        state.patchElement(element.id, {
                          shadow: { ...element.shadow!, angle: Number(angle) },
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
