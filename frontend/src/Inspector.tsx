import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  FolderInput,
  Lock,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { EditorStore } from "./Canvas";
import type { Asset, Palette } from "./types";

function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  return (
    <label className="number-field">
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
    </label>
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
  onImportPalette: (file: File) => void;
  onClose: () => void;
}) {
  const state = useStore(store),
    { scene, selected } = state,
    fileInput = useRef<HTMLInputElement>(null);
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
    <aside className="inspector" aria-label="Настройки композиции">
      <div className="panel-heading">
        <h2>{element ? "Объект" : "Композиция"}</h2>
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
                onChange={(event) =>
                  state.patchElement(element.id, {
                    shadow: event.target.checked
                      ? { angle: 35, length: 1, opacity: 0.35 }
                      : null,
                  })
                }
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
                  Художественная проекция. Направление задаётся относительно
                  предмета; длина — условный масштаб.
                </p>
                <div className="shadow-fields">
                  <div>
                    <span className="field-label">
                      Направление от предмета, °
                    </span>
                    <NumberField
                      label="Направление тени"
                      value={element.shadow.angle}
                      min={0}
                      max={360}
                      disabled={element.locked}
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
                    [0, "Вправо"],
                    [90, "Вниз"],
                    [180, "Влево"],
                    [270, "Вверх"],
                  ].map(([angle, name]) => (
                    <button
                      key={angle}
                      disabled={element.locked}
                      aria-label={`Тень ${String(name).toLowerCase()}`}
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
          <span className="field-label">ПОЛОЖЕНИЕ И ПОВОРОТ</span>
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
              value={element.angle}
              min={-360}
              max={360}
              onCommit={(angle) =>
                !element.locked && state.patchElement(element.id, { angle })
              }
            />
          </div>
          <div className="object-actions">
            <button
              className="icon"
              title="Дублировать"
              aria-label="Дублировать объект"
              onClick={state.duplicate}
            >
              <Copy size={16} />
            </button>
            <button
              className="icon"
              title="На передний план"
              aria-label="Переместить слой выше"
              onClick={() => state.reorder(element.id, 1)}
            >
              <ArrowUp size={16} />
            </button>
            <button
              className="icon"
              aria-label="Переместить слой ниже"
              title="На задний план"
              onClick={() => state.reorder(element.id, -1)}
            >
              <ArrowDown size={16} />
            </button>
            <button
              className="icon danger"
              disabled={element.locked}
              title="Удалить"
              aria-label="Удалить объект"
              onClick={state.remove}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <details className="source-info">
            <summary>Происхождение объекта</summary>
            <p>
              Исходная библиотека Figma
              <br />
              Узел {asset.source_node_id}
              <br />
              Геометрия сохранена
            </p>
          </details>
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
          onClick={() => fileInput.current?.click()}
        >
          <FolderInput size={14} />
          Загрузить палитру
        </button>
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          accept=".json,application/json"
          aria-label="Импорт палитры"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportPalette(file);
            e.target.value = "";
          }}
        />
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
      <div className="inspector-footer">
        <span>SVG</span> Вектор остаётся вектором.
      </div>
    </aside>
  );
}
