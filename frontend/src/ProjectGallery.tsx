import { useId } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  FolderOpen,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { Illustration } from "./Canvas";
import { Brand } from "./Brand";
import { FORMATS, FORMAT_LABELS, type Asset, type Project } from "./types";
import "./panels.css";
export type ProjectGalleryProps = {
  projects: Project[];
  assets: Asset[];
  sources: Record<string, string>;
  loading: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onBack: () => void;
};
export function ProjectGallery({
  projects,
  assets,
  sources,
  loading,
  onOpen,
  onNew,
  onBack,
}: ProjectGalleryProps) {
  const prefix = useId().replace(/:/g, "");
  return (
    <main className="sb-project-gallery">
      <header className="app-header sb-gallery-header">
        <Brand />
        <div className="sb-gallery-actions">
          <button
            type="button"
            className="sb-text-button sb-gallery-back"
            onClick={onBack}
            aria-label="В редактор"
            title="В редактор"
          >
            <ArrowLeft size={17} />
            <span>В редактор</span>
          </button>
          <button type="button" className="sb-primary" onClick={onNew}>
            <Plus size={17} /> Новый проект
          </button>
        </div>
      </header>
      <div className="sb-gallery-scroll">
        <section className="sb-gallery-content" aria-labelledby="gallery-title">
          <div className="sb-gallery-heading">
            <div>
              <span className="sb-eyebrow">ВАШЕ ПРОСТРАНСТВО</span>
              <h1 id="gallery-title">Мои проекты</h1>
            </div>
            <span className="sb-gallery-count">
              {projects.length} сохранено
            </span>
          </div>
          {loading ? (
            <div className="sb-gallery-state" role="status">
              <LoaderCircle size={26} className="sb-spin" />
              <p>Загружаем проекты…</p>
            </div>
          ) : projects.length ? (
            <div className="sb-project-grid">
              {projects.map((project, index) => {
                const { scene } = project,
                  date = new Date(project.updated_at),
                  [width, height] = FORMATS[scene.format];
                return (
                  <article className="sb-project-card" key={project.id}>
                    <button
                      type="button"
                      className="sb-project-open"
                      onClick={() => onOpen(project.id)}
                      aria-label={`Открыть проект «${scene.title || "Без названия"}»`}
                    >
                      <div className="sb-project-preview">
                        <svg
                          viewBox={`0 0 ${width} ${height}`}
                          aria-hidden="true"
                        >
                          <Illustration
                            scene={scene}
                            assets={assets}
                            sources={sources}
                            prefix={`${prefix}-project-${index}`}
                          />
                        </svg>
                        <span className="sb-project-open-icon">
                          <ArrowUpRight size={20} />
                        </span>
                      </div>
                      <div className="sb-project-meta">
                        <h2>{scene.title || "Без названия"}</h2>
                        <div>
                          <time dateTime={project.updated_at}>
                            {Number.isNaN(date.getTime())
                              ? "Дата неизвестна"
                              : date.toLocaleDateString("ru-RU", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                          </time>
                          <span>
                            {FORMAT_LABELS[scene.format]} · {scene.detail}
                          </span>
                        </div>
                      </div>
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="sb-gallery-state">
              <div className="sb-gallery-empty-icon">
                <FolderOpen size={31} />
              </div>
              <h2>Здесь будут ваши иллюстрации</h2>
              <p>Создайте композицию и сохраните её в проект.</p>
              <button type="button" className="sb-primary" onClick={onNew}>
                <Plus size={17} /> Создать проект
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
