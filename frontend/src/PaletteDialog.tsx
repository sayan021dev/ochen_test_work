import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  Check,
  Download,
  LoaderCircle,
  Palette as PaletteIcon,
  Upload,
  X,
} from "lucide-react";
import { download } from "./api";
import type { Palette } from "./types";
import "./panels.css";

export type PaletteDialogProps = {
  open: boolean;
  palette: Palette;
  onClose: () => void;
  onApply: (palette: Palette) => Promise<void>;
};
const SWATCHES = [
  "#111111",
  "#737373",
  "#BDBDBD",
  "#E7E7E7",
  "#FFFFFF",
  "#FFF9F0",
  "#FFE2E8",
  "#FFD7BB",
  "#FFF1B5",
  "#DAEEC9",
  "#CDE7EE",
  "#E2D7F0",
  "#FF68A4",
  "#F4AA7B",
  "#E8CB76",
  "#9DBB91",
  "#8FB8C9",
  "#B3A0CC",
  "#6A2845",
  "#694431",
  "#66572D",
  "#3D5139",
  "#304B5D",
  "#4C3F65",
];
const HEX = /^#[0-9a-f]{6}$/i;
function parsePalette(value: unknown): Palette {
  if (!value || typeof value !== "object")
    throw new Error("В JSON должен быть объект палитры.");
  const p = value as Partial<Palette>;
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 60)
    throw new Error("Добавьте название палитры: от 1 до 60 символов.");
  if (
    ![p.background, p.object].every(
      (colors) =>
        Array.isArray(colors) &&
        colors.length === 4 &&
        colors.every((c) => typeof c === "string" && HEX.test(c)),
    )
  )
    throw new Error(
      "Нужны 4 цвета background и 4 цвета object в формате #RRGGBB.",
    );
  return {
    id: typeof p.id === "string" && p.id ? p.id : "custom",
    name: p.name.trim(),
    background: p.background!.map((c) => c.toUpperCase()),
    object: p.object!.map((c) => c.toUpperCase()),
  };
}
export function PaletteDialog({ open, ...props }: PaletteDialogProps) {
  return open ? <PaletteForm {...props} /> : null;
}
function PaletteForm({
  palette,
  onClose,
  onApply,
}: Omit<PaletteDialogProps, "open">) {
  const id = useId(),
    dialog = useRef<HTMLDialogElement>(null),
    active = useRef(false),
    fileRequest = useRef(0);
  const [draft, setDraft] = useState<Palette>(() => ({
    ...palette,
    name: "Своя палитра",
    background: [...palette.background],
    object: [...palette.object],
  }));
  const [tab, setTab] = useState<"create" | "import">("create");
  const [slot, setSlot] = useState<{
    role: "background" | "object";
    index: number;
  }>({ role: "background", index: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState("");
  useEffect(() => {
    const node = dialog.current!;
    active.current = true;
    node.showModal();
    return () => {
      active.current = false;
      fileRequest.current += 1;
      node.close();
    };
  }, []);
  const close = () => {
    active.current = false;
    fileRequest.current += 1;
    onClose();
  };
  const updateColor = (
    role: "background" | "object",
    index: number,
    color: string,
  ) => {
    setDraft((old) => ({
      ...old,
      [role]: old[role].map((c, i) => (i === index ? color : c)),
    }));
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      const candidate = parsePalette(draft);
      setBusy(true);
      await onApply(candidate);
      if (active.current) close();
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось применить палитру. Попробуйте ещё раз.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const importFile = async (file: File) => {
    const request = ++fileRequest.current;
    setError("");
    setImported("");
    try {
      if (file.size > 128 * 1024)
        throw new Error("Файл слишком большой. Максимум — 128 КБ.");
      const text = await file.text();
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error("Не удалось прочитать JSON. Проверьте формат файла.");
      }
      const candidate = parsePalette(value);
      if (active.current && request === fileRequest.current) {
        setDraft(candidate);
        setImported(file.name);
      }
    } catch (cause) {
      if (active.current && request === fileRequest.current)
        setError(
          cause instanceof Error ? cause.message : "Не удалось прочитать файл.",
        );
    }
  };
  return (
    <dialog
      ref={dialog}
      className="sb-dialog sb-palette-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <header className="sb-dialog-heading">
          <div>
            <span className="sb-eyebrow">
              <PaletteIcon size={14} /> ЦВЕТ КОМПОЗИЦИИ
            </span>
            <h2 id={`${id}-title`}>Своя палитра</h2>
          </div>
          <button
            className="sb-icon"
            type="button"
            aria-label="Закрыть палитру"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <p className="sb-description" id={`${id}-description`}>
          Четыре оттенка фона и четыре цвета объектов. Цвета фона можно
          использовать и в объектах.
        </p>
        <div
          className="sb-tabs"
          role="tablist"
          aria-label="Способ создания палитры"
        >
          {(
            [
              ["create", "Создать палитру"],
              ["import", "Импорт JSON"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`${id}-${value}-tab`}
              aria-controls={`${id}-${value}-panel`}
              aria-selected={tab === value}
              tabIndex={tab === value ? 0 : -1}
              onClick={() => setTab(value)}
              onKeyDown={(event) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "create"
                      : event.key === "End"
                        ? "import"
                        : tab === "create"
                          ? "import"
                          : "create";
                  setTab(next);
                  document.getElementById(`${id}-${next}-tab`)?.focus();
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${id}-${tab}-panel`}
          aria-labelledby={`${id}-${tab}-tab`}
          className="sb-palette-content"
        >
          {tab === "create" ? (
            <>
              <label className="sb-field">
                Название
                <input
                  value={draft.name}
                  maxLength={60}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </label>
              {(
                [
                  ["background", "Фон", "фона"],
                  ["object", "Объекты", "объекта"],
                ] as const
              ).map(([role, title, noun]) => (
                <fieldset className="sb-color-group" key={role} disabled={busy}>
                  <legend>
                    {title}
                    <span>4 оттенка</span>
                  </legend>
                  <div className="sb-color-slots">
                    {draft[role].map((color, index) => (
                      <div
                        className={`sb-color-slot ${slot.role === role && slot.index === index ? "is-active" : ""}`}
                        key={index}
                        onFocus={() => setSlot({ role, index })}
                      >
                        <label
                          className="sb-color-picker"
                          style={{
                            backgroundColor: HEX.test(color)
                              ? color
                              : "#333333",
                          }}
                        >
                          <span className="sb-sr-only">
                            Цвет {noun} {index + 1}
                          </span>
                          <input
                            type="color"
                            value={HEX.test(color) ? color : "#000000"}
                            onChange={(event) =>
                              updateColor(
                                role,
                                index,
                                event.target.value.toUpperCase(),
                              )
                            }
                          />
                        </label>
                        <input
                          aria-label={`HEX ${noun} ${index + 1}`}
                          className="sb-hex"
                          value={color}
                          maxLength={7}
                          spellCheck={false}
                          onChange={(event) =>
                            updateColor(role, index, event.target.value)
                          }
                        />
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))}
              <div className="sb-swatches-heading">
                <span>Быстрый выбор</span>
                <small>
                  Для {slot.role === "background" ? "фона" : "объекта"}{" "}
                  {slot.index + 1}
                </small>
              </div>
              <div className="sb-preset-swatches" aria-label="Готовые цвета">
                {SWATCHES.map((color) => (
                  <button
                    type="button"
                    key={color}
                    disabled={busy}
                    aria-label={`Выбрать цвет ${color}`}
                    title={color}
                    style={{ backgroundColor: color }}
                    onClick={() => updateColor(slot.role, slot.index, color)}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="sb-import-panel">
              <Upload size={26} />
              <h3>Загрузите палитру</h3>
              <p>
                JSON с названием name, четырьмя HEX-цветами background и
                четырьмя object.
              </p>
              <label className="sb-file-button">
                Выбрать JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  aria-label="Импорт палитры"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importFile(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {imported && (
                <p className="sb-import-success" role="status">
                  <Check size={15} /> {imported} — готова к применению
                </p>
              )}
              <button
                type="button"
                className="sb-text-button"
                onClick={() =>
                  download(
                    new Blob(
                      [
                        JSON.stringify(
                          {
                            id: "custom",
                            name: "Моя палитра",
                            background: palette.background,
                            object: palette.object,
                          },
                          null,
                          2,
                        ),
                      ],
                      { type: "application/json" },
                    ),
                    "palette-example.json",
                  )
                }
              >
                <Download size={15} /> Скачать пример JSON
              </button>
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="sb-error">
            {error}
          </p>
        )}
        <footer className="sb-dialog-footer">
          <button type="button" className="sb-secondary" onClick={close}>
            Отмена
          </button>
          <button type="submit" className="sb-primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="sb-spin" />
            ) : (
              <Check size={16} />
            )}
            Применить палитру
          </button>
        </footer>
      </form>
    </dialog>
  );
}
