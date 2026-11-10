import { ArrowUpRight, Search } from "lucide-react";
import { useState } from "react";
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
  const [search, setSearch] = useState("");
  const items = assets.filter(
    (a) =>
      a.detail === detail &&
      a.role === "main" &&
      a.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="library-section" aria-labelledby="library-title">
      <div className="section-title">
        <h2 id="library-title">Библиотека</h2>
        <span className="count">10 предметов</span>
      </div>
      <label className="search-field">
        <Search size={15} />
        <input
          aria-label="Поиск предмета"
          placeholder="Найти предмет"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <kbd>⌕</kbd>
      </label>
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
      {!items.length && (
        <p className="muted">
          Такого предмета нет. Попробуйте другое название.
        </p>
      )}
      <p className="library-note">
        <span className="status-dot" /> Только исходные векторные объекты
      </p>
    </section>
  );
}
