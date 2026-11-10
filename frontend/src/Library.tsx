import { ArrowUpRight } from "lucide-react";
import type { Asset, Detail, Family } from "./types";

export function Library({
  assets,
  detail,
  onAdd,
  disabled,
}: {
  assets: Asset[];
  detail: Detail;
  onAdd: (family: Family) => void;
  disabled: boolean;
}) {
  const items = assets.filter((a) => a.detail === detail && a.role === "main");
  return (
    <section className="library-section" aria-labelledby="library-title">
      <div className="section-title">
        <h2 id="library-title">Библиотека</h2>
        <span className="count">{items.length} предметов</span>
      </div>
      <div className="library-grid">
        {items.map((a) => (
          <button
            className="asset-card"
            key={a.id}
            onClick={() => onAdd(a.family)}
            disabled={disabled}
            aria-label={`Добавить ${a.name}`}
          >
            <span className="asset-preview">
              <img src={a.url} alt="" draggable={false} />
              <ArrowUpRight size={14} />
            </span>
            <span>{a.name}</span>
          </button>
        ))}
      </div>
      <p className="library-note">
        <span className="status-dot" /> Только исходные векторные объекты
      </p>
    </section>
  );
}
