import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Cloud,
  Code2,
  Download,
  FolderOpen,
  Layers3,
  Loader2,
  Maximize,
  Minus,
  PanelLeft,
  Plus,
  Redo2,
  Settings2,
  Sparkles,
  Undo2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { api, ApiError, download } from "./api";
import { Canvas, Illustration, type EditorStore } from "./Canvas";
import { Inspector } from "./Inspector";
import { Library } from "./Library";
import { createEditorStore, defaultScene } from "./state";
import {
  FORMATS,
  type Bootstrap,
  type Composition,
  type Project,
} from "./types";

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Не удалось выполнить действие";

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null),
    [sources, setSources] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const bootstrap = await api.bootstrap();
      const files = await Promise.all(
        bootstrap.assets.map(async (a) => {
          const response = await fetch(a.url);
          if (!response.ok) throw new Error("Не удалось загрузить библиотеку");
          return [a.id, await response.text()] as const;
        }),
      );
      setSources(Object.fromEntries(files));
      setData(bootstrap);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data)
    return (
      <main className="loading-screen">
        <span className="brand-mark">
          <i />
          <i />
          <i />
        </span>
        <h1>Сложено</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="primary" onClick={() => void load()}>
              Повторить
            </button>
          </>
        ) : (
          <p>
            <Loader2 className="spin" size={16} /> Открываем векторную
            мастерскую
          </p>
        )}
      </main>
    );
  return <Editor data={data} sources={sources} />;
}

function Editor({
  data,
  sources,
}: {
  data: Bootstrap;
  sources: Record<string, string>;
}) {
  const [store] = useState(() =>
    createEditorStore(defaultScene(data.palettes[0])),
  );
  const state = useStore(store),
    { scene, selected } = state;
  const [mode, setMode] = useState<"metaphor" | "components">("metaphor");
  const [prompt, setPrompt] = useState(""),
    [useAI, setUseAI] = useState(data.ai.configured),
    [backgrounds, setBackgrounds] = useState(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [saveStatus, setSaveStatus] = useState("Не сохранено");
  const [conflict, setConflict] = useState(false),
    [composition, setComposition] = useState<Composition | null>(null);
  const [palettes, setPalettes] = useState(data.palettes),
    [zoom, setZoom] = useState(1),
    [leftOpen, setLeftOpen] = useState(false),
    [rightOpen, setRightOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]),
    [showProjects, setShowProjects] = useState(false),
    [showHelp, setShowHelp] = useState(false);
  const projectsDialog = useRef<HTMLDialogElement>(null),
    helpDialog = useRef<HTMLDialogElement>(null),
    projectInput = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false),
    restored = useRef(false);
  const dirty = state.changeVersion !== state.savedVersion;
  const [width, height] = FORMATS[scene.format];

  const save = useCallback(
    async (copy = false) => {
      if (savingRef.current) return;
      const snapshot = store.getState(),
        epoch = snapshot.documentEpoch;
      savingRef.current = true;
      setSaving(true);
      setSaveStatus("Сохраняем…");
      try {
        const project = await api.save(
          snapshot.scene,
          copy ? null : snapshot.projectId,
          copy ? 0 : snapshot.serverRevision,
        );
        if (store.getState().documentEpoch === epoch) {
          store
            .getState()
            .saved(project.id, project.revision, snapshot.changeVersion);
          localStorage.setItem("ochen:last-project", project.id);
          const url = new URL(window.location.href);
          url.searchParams.set("project", project.id);
          history.replaceState({}, "", url);
          setSaveStatus("Сохранено");
          setConflict(false);
        }
      } catch (e) {
        setSaveStatus("Не сохранено");
        setError(errorMessage(e));
        if (e instanceof ApiError && e.status === 409) setConflict(true);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [store],
  );

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const id =
      new URLSearchParams(location.search).get("project") ??
      localStorage.getItem("ochen:last-project");
    if (id)
      void api
        .project(id)
        .then((p) => {
          store.getState().hydrate(p.scene, p.id, p.revision);
          setSaveStatus("Сохранено");
          if (!palettes.some((a) => a.id === p.scene.palette.id))
            setPalettes((ps) => [...ps, p.scene.palette]);
        })
        .catch(() => {
          localStorage.removeItem("ochen:last-project");
          setError(
            "Сохранённый проект недоступен в этой сессии. Открыта стартовая композиция.",
          );
        });
  }, [store, palettes]);

  useEffect(() => {
    if (!dirty || conflict || saving || busy || state.dragBaseline) return;
    const timer = setTimeout(() => void save(), 1400);
    return () => clearTimeout(timer);
  }, [
    dirty,
    conflict,
    saving,
    busy,
    state.changeVersion,
    state.dragBaseline,
    save,
  ]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (store.getState().changeVersion !== store.getState().savedVersion) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [store]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(
          'input,textarea,select,[contenteditable="true"],dialog',
        ) ||
        busy
      )
        return;
      const s = store.getState(),
        mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) s.redo();
        else s.undo();
      } else if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      } else if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        s.duplicate();
      } else if (event.key === "Escape") s.select(null);
      else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        s.remove();
      } else if (event.key.startsWith("Arrow")) {
        const selected = s.scene.elements.find((e) => e.id === s.selected);
        if (!selected || selected.locked) return;
        event.preventDefault();
        const delta = event.shiftKey ? 10 : 1;
        const x = Math.max(
          -5000,
          Math.min(
            5000,
            selected.x +
              (event.key === "ArrowRight"
                ? delta
                : event.key === "ArrowLeft"
                  ? -delta
                  : 0),
          ),
        );
        const y = Math.max(
          -5000,
          Math.min(
            5000,
            selected.y +
              (event.key === "ArrowDown"
                ? delta
                : event.key === "ArrowUp"
                  ? -delta
                  : 0),
          ),
        );
        s.patchElement(selected.id, { x, y });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [store, save, busy]);

  useEffect(() => {
    if (selected) setRightOpen(true);
  }, [selected]);
  useEffect(() => {
    if (showProjects) projectsDialog.current?.showModal();
    else projectsDialog.current?.close();
  }, [showProjects]);
  useEffect(() => {
    if (showHelp) helpDialog.current?.showModal();
    else helpDialog.current?.close();
  }, [showHelp]);

  const generate = async () => {
    if (!prompt.trim()) {
      setError("Опишите идею или перечислите предметы.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.compose({
        prompt,
        mode,
        format: scene.format,
        detail: scene.detail,
        palette: scene.palette,
        seed: 0,
        backgrounds,
        use_ai: useAI,
      });
      state.change(result.scenes[0]);
      state.select(null);
      setComposition(result);
      setZoom(1);
      setLeftOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const exportSVG = async () => {
    try {
      download(await api.export(store.getState().scene), "сложено.svg");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const exportProject = () =>
    download(
      new Blob([JSON.stringify(store.getState().scene, null, 2)], {
        type: "application/json",
      }),
      "сложено-проект.json",
    );
  const importPalette = async (file: File) => {
    try {
      if (file.size > 20000)
        throw new Error("Файл палитры слишком большой. Максимум 20 КБ.");
      const candidate: unknown = JSON.parse(await file.text());
      const validated = await api.validate({
        ...store.getState().scene,
        palette: candidate,
      });
      state.change(validated);
      setPalettes((p) => [
        ...p.filter((a) => a.id !== validated.palette.id),
        validated.palette,
      ]);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const importProject = async (file: File) => {
    try {
      if (file.size > 262144)
        throw new Error("Файл проекта слишком большой. Максимум 256 КБ.");
      const validated = await api.validate(JSON.parse(await file.text()));
      store.getState().hydrate(validated);
      store.getState().change({ ...validated });
      setSaveStatus("Импортирован · сохраните проект");
      setConflict(false);
      setComposition(null);
      setError("");
      if (!palettes.some((p) => p.id === validated.palette.id))
        setPalettes((p) => [...p, validated.palette]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const openProject = async (id: string) => {
    try {
      const p = await api.project(id);
      state.hydrate(p.scene, p.id, p.revision);
      setSaveStatus("Сохранено");
      setConflict(false);
      setComposition(null);
      setShowProjects(false);
      setError("");
      localStorage.setItem("ochen:last-project", p.id);
      const url = new URL(window.location.href);
      url.searchParams.set("project", p.id);
      history.replaceState({}, "", url);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const newProject = () => {
    if (dirty) {
      setError("Сначала сохраните текущий проект или скачайте JSON.");
      return;
    }
    state.hydrate(defaultScene(palettes[0]));
    localStorage.removeItem("ochen:last-project");
    history.replaceState({}, "", "/");
    setSaveStatus("Не сохранено");
    setComposition(null);
    setConflict(false);
  };
  const showLibrary = () => setLeftOpen(!leftOpen);

  return (
    <div
      className={`app-shell ${leftOpen ? "left-open" : ""} ${rightOpen ? "right-open" : ""}`}
    >
      <header className="app-header">
        <a className="brand" href="/" aria-label="Сложено, главная">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <h1>Сложено</h1>
          <span className="brand-divider" />
          <span className="brand-caption">Векторная мастерская</span>
        </a>
        <div className="header-center">
          <span className="outline-pill">
            <span className="status-dot" /> Из готовых объектов
          </span>
        </div>
        <div className="header-actions">
          <button
            className="text-button"
            onClick={() => {
              setShowProjects(true);
              void api
                .projects()
                .then(setProjects)
                .catch((e) => setError(errorMessage(e)));
            }}
          >
            <FolderOpen size={16} />
            <span>Мои работы</span>
          </button>
          <button
            className="icon help-button"
            aria-label="Помощь"
            onClick={() => setShowHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
          <span className="avatar">Р</span>
        </div>
      </header>
      <aside className="left-panel" aria-label="Идея и библиотека">
        <div className="prompt-section">
          <div className="section-title">
            <span className="eyebrow">НАЧНИТЕ С ИДЕИ</span>
            <button
              className="icon mobile-only"
              aria-label="Закрыть библиотеку"
              onClick={() => setLeftOpen(false)}
            >
              <X size={17} />
            </button>
            <span className="ai-badge">
              <Sparkles size={12} /> Подбор
            </span>
          </div>
          <h2>Что соберём?</h2>
          <p className="intro-copy">Опишите смысл. Предметы найдутся.</p>
          <div
            className="segmented prompt-tabs"
            role="tablist"
            aria-label="Сценарий сборки"
          >
            <button
              role="tab"
              aria-selected={mode === "metaphor"}
              onClick={() => setMode("metaphor")}
            >
              <Sparkles size={14} />
              Идея
            </button>
            <button
              role="tab"
              aria-selected={mode === "components"}
              onClick={() => setMode("components")}
            >
              <Layers3 size={14} />
              Предметы
            </button>
          </div>
          <div className="prompt-input">
            <textarea
              aria-label="Описание композиции"
              placeholder={
                mode === "metaphor"
                  ? "Например, «Собрать знания в систему»"
                  : "Книга, лампа, наушники…"
              }
              value={prompt}
              maxLength={1000}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                  void generate();
              }}
            />
            <span className="prompt-counter">{prompt.length}/1000</span>
          </div>
          <div className="prompt-examples">
            <span>Попробуйте</span>
            {(mode === "metaphor"
              ? ["Фокус на главном", "Собрать знания в систему"]
              : ["Книга, лампа, наушники", "Кошелёк, монета"]
            ).map((example) => (
              <button key={example} onClick={() => setPrompt(example)}>
                {example}
                <ArrowUpRightIcon />
              </button>
            ))}
          </div>
          <button
            className="primary generate-button"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <Sparkles size={16} />
            )}
            <span>{busy ? "Собираем композицию…" : "Собрать композицию"}</span>
            {!busy && <ArrowRight size={16} />}
          </button>
          <div className="generation-options">
            <label>
              <input
                type="checkbox"
                checked={backgrounds}
                onChange={(e) => setBackgrounds(e.target.checked)}
              />
              Фоновые объекты
            </label>
            {mode === "metaphor" && (
              <label
                title={
                  data.ai.configured
                    ? data.ai.model
                    : "API не настроен: доступен словарь"
                }
              >
                <input
                  type="checkbox"
                  aria-label="Использовать OpenAI"
                  checked={useAI}
                  disabled={!data.ai.configured}
                  onChange={(e) => setUseAI(e.target.checked)}
                />
                OpenAI
              </label>
            )}
          </div>
        </div>
        <Library
          assets={data.assets}
          detail={scene.detail}
          onAdd={(family) => {
            state.add(family);
            setLeftOpen(false);
          }}
          disabled={busy || scene.elements.length >= 48}
        />
        <div className="left-footer">
          <span>Сделано для тестового задания</span>
          <span>01 / V1</span>
        </div>
      </aside>
      <main className="workspace">
        <div className="document-toolbar">
          <div className="document-title">
            <span className="document-icon">
              <Code2 size={16} />
            </span>
            <input
              aria-label="Название проекта"
              value={scene.title}
              maxLength={120}
              onChange={(e) => {
                if (e.target.value.trim())
                  state.change({ ...scene, title: e.target.value });
              }}
            />
            <ChevronDown size={13} />
          </div>
          <div className="document-actions">
            <span role="status" className="save-status">
              {saving ? (
                <Loader2 size={12} className="spin" />
              ) : dirty ? (
                <Cloud size={13} />
              ) : (
                <Check size={13} />
              )}
              <span>{dirty && !saving ? "Есть изменения" : saveStatus}</span>
            </span>
            <button
              className="icon"
              aria-label="Новый проект"
              title="Новый проект"
              onClick={newProject}
            >
              <Plus size={17} />
            </button>
            <button
              className="icon"
              aria-label="Сохранить проект"
              title="Сохранить проект"
              disabled={saving}
              onClick={() => void save()}
            >
              <Cloud size={17} />
            </button>
            <button
              className="export-button"
              aria-label="Скачать SVG"
              onClick={() => void exportSVG()}
            >
              <Download size={15} />
              <span>Скачать SVG</span>
            </button>
          </div>
        </div>
        <div className="canvas-toolbar">
          <div className="format-control">
            {(
              [
                ["square", "Пост 1:1"],
                ["landscape", "Обложка 1.91:1"],
                ["portrait", "Постер 2:3"],
              ] as const
            ).map(([format, label]) => (
              <button
                key={format}
                aria-label={label}
                aria-pressed={scene.format === format}
                onClick={() => {
                  state.change({ ...scene, format });
                  setZoom(1);
                }}
              >
                <span className={`format-shape ${format}`} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="history-controls">
            <button
              className="icon"
              aria-label="Отменить"
              title="Отменить · ⌘Z"
              disabled={!state.past.length}
              onClick={state.undo}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="icon"
              aria-label="Повторить"
              title="Повторить · ⇧⌘Z"
              disabled={!state.future.length}
              onClick={state.redo}
            >
              <Redo2 size={16} />
            </button>
          </div>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            <span>{error}</span>
            {conflict && (
              <button onClick={() => void save(true)}>Сохранить копию</button>
            )}
            <button
              className="icon"
              aria-label="Закрыть сообщение"
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <div className="stage-area">
          <div className="stage-label">
            <span>
              КОМПОЗИЦИЯ <b>01</b>
            </span>
            <span>
              {width} × {height} px <span className="small-dot" /> SVG
            </span>
          </div>
          <div
            className={`artboard-space ${scene.transparent ? "checkerboard" : ""} ${busy ? "busy" : ""}`}
          >
            <Canvas
              store={store}
              assets={data.assets}
              sources={sources}
              zoom={zoom}
              busy={busy}
            />
            {busy && (
              <div className="composing-overlay">
                <Loader2 size={22} className="spin" />
                <span>Подбираем предметы и композицию</span>
              </div>
            )}
          </div>
          <div className="stage-bottom">
            <span>
              <span className="status-dot" /> {scene.elements.length} предмета ·{" "}
              {scene.detail === "L" ? "Подробная" : "Компактная"} детализация
            </span>
            <div className="zoom-controls">
              <button
                className="icon"
                aria-label="Уменьшить масштаб просмотра"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
              >
                <Minus size={13} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                className="icon"
                aria-label="Увеличить масштаб просмотра"
                onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              >
                <ZoomIn size={13} />
              </button>
              <button
                className="icon"
                aria-label="Вписать в окно"
                onClick={() => setZoom(1)}
              >
                <Maximize size={13} />
              </button>
            </div>
          </div>
        </div>
        <div className="composition-bottom">
          <div className="concept-card">
            <span className="concept-icon">
              <Sparkles size={16} />
            </span>
            <div>
              <div className="concept-heading">
                <h2>
                  {composition
                    ? "Почему эти предметы"
                    : "У каждой идеи есть форма"}
                </h2>
                <span className="tiny-label">
                  {composition?.provider === "openai"
                    ? "OpenAI"
                    : composition?.provider === "dictionary"
                      ? "Словарный подбор"
                      : "Готовая библиотека"}
                </span>
              </div>
              <p>
                {composition?.explanation ??
                  "Начните с метафоры или добавьте предметы вручную. Мы сохраним исходный вектор, детали и характер иллюстраций."}
              </p>
            </div>
          </div>
          {composition && (
            <section className="variants" aria-label="Варианты композиции">
              <div className="section-title">
                <h2>Можно и так</h2>
                <span className="tiny-label">
                  Те же предметы, другой акцент
                </span>
              </div>
              <div className="variant-grid">
                {composition.scenes.map((variant, i) => (
                  <button
                    key={i}
                    className="variant-card"
                    aria-label={`Вариант композиции ${i + 1}`}
                    onClick={() =>
                      state.change({
                        ...variant,
                        palette: scene.palette,
                        detail: scene.detail,
                        scale:
                          variant.scale *
                          (scene.detail !== variant.detail
                            ? scene.detail === "S"
                              ? 2
                              : 0.5
                            : 1),
                      })
                    }
                  >
                    <svg viewBox={`0 0 ${FORMATS[variant.format].join(" ")}`}>
                      <Illustration
                        scene={variant}
                        assets={data.assets}
                        sources={sources}
                        prefix={`variant-${i}`}
                      />
                    </svg>
                    <span>
                      0{i + 1}
                      <ArrowRight size={13} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
        <footer className="workspace-footer">
          <span>
            <CheckCircle2 size={13} /> Исходные контуры сохранены
          </span>
          <div>
            <button className="text-button" onClick={exportProject}>
              <ArrowDownToLine size={13} />
              JSON проекта
            </button>
            <button
              className="text-button"
              onClick={() => projectInput.current?.click()}
            >
              <Upload size={13} />
              Открыть JSON
            </button>
          </div>
          <input
            ref={projectInput}
            className="sr-only"
            type="file"
            accept=".json"
            aria-label="Импорт проекта"
            onChange={(e) => {
              if (e.target.files?.[0]) void importProject(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </footer>
      </main>
      <Inspector
        store={store}
        assets={data.assets}
        palettes={palettes}
        onImportPalette={(file) => void importPalette(file)}
        onClose={() => setRightOpen(false)}
      />
      <nav className="mobile-panels" aria-label="Панели редактора">
        <button onClick={showLibrary}>
          <PanelLeft size={17} />
          Идея и предметы
        </button>
        <button onClick={() => setRightOpen(!rightOpen)}>
          <Settings2 size={17} />
          Настройки
        </button>
      </nav>
      <dialog
        ref={projectsDialog}
        onClose={() => setShowProjects(false)}
        className="projects-dialog"
      >
        <div className="dialog-title">
          <h2>Мои работы</h2>
          <button
            className="icon"
            aria-label="Закрыть мои работы"
            onClick={() => setShowProjects(false)}
          >
            <X size={19} />
          </button>
        </div>
        {!projects.length ? (
          <p className="muted">
            Сохраните первую композицию, и она появится здесь.
          </p>
        ) : (
          <div className="project-list">
            {projects.map((p) => (
              <button key={p.id} onClick={() => void openProject(p.id)}>
                <FolderOpen size={20} />
                <span>
                  <strong>{p.scene.title}</strong>
                  <small>
                    {new Date(p.updated_at).toLocaleDateString("ru-RU")} ·{" "}
                    {p.scene.elements.length} предмета
                  </small>
                </span>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
        )}
      </dialog>
      <dialog
        ref={helpDialog}
        onClose={() => setShowHelp(false)}
        className="help-dialog"
      >
        <div className="dialog-title">
          <h2>
            Маленькая мастерская,
            <br />
            большие возможности
          </h2>
          <button
            className="icon"
            aria-label="Закрыть помощь"
            onClick={() => setShowHelp(false)}
          >
            <X size={19} />
          </button>
        </div>
        <p>
          Введите идею или назовите предметы. Композиция собирается только из
          исходной SVG-библиотеки. OpenAI помогает выбрать смысл, а векторная
          геометрия остаётся неизменной.
        </p>
        <div className="shortcut-list">
          <span>
            Передвинуть предмет<kbd>↑ ↓ ← →</kbd>
          </span>
          <span>
            Шаг 10 пикселей<kbd>Shift + стрелки</kbd>
          </span>
          <span>
            Отменить действие<kbd>⌘ / Ctrl + Z</kbd>
          </span>
          <span>
            Дублировать<kbd>⌘ / Ctrl + D</kbd>
          </span>
          <span>
            Сохранить<kbd>⌘ / Ctrl + S</kbd>
          </span>
          <span>
            Удалить<kbd>Delete</kbd>
          </span>
        </div>
        <p className="help-text">
          Палитра JSON: поля id, name, background и object. В каждой группе
          ровно 4 HEX-цвета. Файл-пример находится в репозитории.
        </p>
      </dialog>
    </div>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 12 12 4M4 4h8v8" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export type { EditorStore };
