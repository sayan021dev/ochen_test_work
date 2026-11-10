import { ChevronDown, Download, FileJson, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
export function DownloadMenu({
  onSVG,
  onJSON,
  onImport,
}: {
  onSVG: () => void;
  onJSON: () => void;
  onImport: () => void;
}) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div
      className="download-menu"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          button.current?.focus();
          e.stopPropagation();
        }
      }}
    >
      <button
        ref={button}
        className="export-button"
        aria-label="Скачать SVG"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Download size={15} />
        <span>Скачать SVG</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          className="download-popover"
          role="menu"
          aria-label="Экспорт и импорт"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSVG();
            }}
          >
            <Download size={16} />
            Скачать SVG
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onJSON();
            }}
          >
            <FileJson size={16} />
            Скачать JSON проекта
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onImport();
            }}
          >
            <Upload size={16} />
            Открыть JSON
          </button>
        </div>
      )}
    </div>
  );
}
