import { useEffect, useId, useRef } from "react";
import { ArrowRight, Download, MousePointer2, Sparkles, X } from "lucide-react";
import "./panels.css";
export type WelcomeDialogProps = { open: boolean; onClose: () => void };
export function WelcomeDialog({ open, onClose }: WelcomeDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const node = dialog.current!;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
    return () => {
      if (node.open) node.close();
    };
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="sb-dialog sb-welcome-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="sb-dialog-heading">
        <span className="sb-eyebrow">
          Привет, это <span className="sb-welcome-brand">Сложено</span>
        </span>
        <button
          className="sb-icon"
          type="button"
          aria-label="Закрыть приветствие"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <svg
        className="sb-welcome-art"
        viewBox="0 0 440 140"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="16"
          y="24"
          width="90"
          height="90"
          rx="22"
          transform="rotate(-14 61 69)"
          fill="#FF68A4"
          fillOpacity=".15"
          stroke="#FF9FC6"
          strokeOpacity=".55"
        />
        <rect
          x="102"
          y="16"
          width="96"
          height="96"
          rx="25"
          transform="rotate(15 150 64)"
          fill="#FFD1E2"
          fillOpacity=".25"
          stroke="#FFD1E2"
          strokeOpacity=".75"
        />
        <rect
          x="201"
          y="30"
          width="78"
          height="78"
          rx="22"
          transform="rotate(-8 240 69)"
          fill="#BCA4DF"
          fillOpacity=".19"
          stroke="#C9B0E6"
          strokeOpacity=".55"
        />
        <g transform="translate(333 43)" color="#FF9FC6">
          <Sparkles size={44} strokeWidth={1.8} />
        </g>
      </svg>
      <div className="sb-welcome-intro">
        <h2 id={`${id}-title`}>
          У каждой идеи <br />
          есть форма
        </h2>
        <p className="sb-description" id={`${id}-description`}>
          Соберите её из готовых векторных объектов.
        </p>
      </div>
      <ol className="sb-welcome-steps">
        <li>
          <Sparkles size={20} />
          <div>
            <strong>Задайте идею</strong>
            <p>Напишите метафору или перечислите предметы.</p>
          </div>
        </li>
        <li>
          <MousePointer2 size={20} />
          <div>
            <strong>Сделайте по-своему</strong>
            <p>Выберите вариант, переместите объекты и настройте цвета.</p>
          </div>
        </li>
        <li>
          <Download size={20} />
          <div>
            <strong>Заберите вектор</strong>
            <p>Скачайте SVG и продолжите редактирование в Figma.</p>
          </div>
        </li>
      </ol>
      <button
        type="button"
        className="sb-primary sb-welcome-start"
        onClick={onClose}
      >
        Начать создавать <ArrowRight size={17} />
      </button>
    </dialog>
  );
}
