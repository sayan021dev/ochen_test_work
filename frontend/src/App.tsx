import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  PencilLine,
  FolderOpen,
  Layers3,
  Loader2,
  Maximize,
  PanelLeft,
  Plus,
  Redo2,
  Settings2,
  Sparkles,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { api, ApiError, download } from "./api";
import { Canvas, Illustration, type EditorStore } from "./Canvas";
import { Inspector } from "./Inspector";
import { Library } from "./Library";
import { PasswordGate } from "./PasswordGate";
import { PaletteDialog } from "./PaletteDialog";
import { WelcomeDialog } from "./WelcomeDialog";
import { ProjectGallery } from "./ProjectGallery";
import { DownloadMenu } from "./DownloadMenu";
import { createEditorStore, defaultScene } from "./state";
import { framePatch, selectionFrame } from "./geometry";
import {
  FORMATS,
  FORMAT_LABELS,
  type Format,
  type Bootstrap,
  type Composition,
  type Palette,
  type Project,
  type Scene,
} from "./types";

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Не удалось выполнить действие";

const unchanged = (
  store: EditorStore,
  snapshot: ReturnType<EditorStore["getState"]>,
) => {
  const current = store.getState();
  return (
    current.documentEpoch === snapshot.documentEpoch &&
    current.scene === snapshot.scene
  );
};

function canonicalPalette(palette: Palette, originals: Palette[]): Palette {
  const sameColors = (p: Palette) =>
    JSON.stringify([p.background, p.object]) ===
    JSON.stringify([palette.background, palette.object]);
  const original = originals.find(sameColors);
  if (original) return original;
  // Stable content ID keeps all original palettes available even when an imported ID collides.
  let hash = 2166136261;
  for (const c of JSON.stringify([palette.background, palette.object]))
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return { ...palette, id: `custom-${(hash >>> 0).toString(16)}` };
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null),
    [sources, setSources] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try {
      const access = await api.auth();
      setLocked(access.required && !access.authenticated);
      if (access.required && !access.authenticated) return;
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
  useEffect(() => {
    const requireAuth = () => setLocked(true);
    window.addEventListener("ochen:auth-required", requireAuth);
    return () => window.removeEventListener("ochen:auth-required", requireAuth);
  }, []);
  const login = async (password: string) => {
    const access = await api.login(password);
    if (data && access.sessionChanged)
      window.dispatchEvent(new Event("ochen:session-replaced"));
    setLocked(false);
    if (!data) await load();
  };
  if (!data && locked) return <PasswordGate onLogin={login} />;
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
            <Loader2 className="spin" size={16} /> Открываем редактор
          </p>
        )}
      </main>
    );
  return (
    <>
      <div inert={locked || undefined}>
        <Editor data={data} sources={sources} locked={locked} />
      </div>
      {locked && (
        <div className="auth-overlay">
          <PasswordGate onLogin={login} />
        </div>
      )}
    </>
  );
}

function Editor({
  data,
  sources,
  locked,
}: {
  data: Bootstrap;
  locked: boolean;
  sources: Record<string, string>;
}) {
  const [store] = useState(() =>
    createEditorStore(defaultScene(data.palettes[0])),
  );
  const state = useStore(store),
    { scene, selected } = state;
  const [mode, setMode] = useState<"metaphor" | "components">("metaphor");
  const [prompt, setPrompt] = useState(""),
    [backgrounds, setBackgrounds] = useState(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [saveStatus, setSaveStatus] = useState("Не сохранено");
  const [conflict, setConflict] = useState(false),
    [composition, setComposition] = useState<Composition | null>(null);
  const [variantsOpen, setVariantsOpen] = useState(true);
  const leftPanelScroll = useRef<HTMLDivElement>(null);
  const [palettes, setPalettes] = useState(data.palettes),
    [zoom, setZoom] = useState(1),
    [leftOpen, setLeftOpen] = useState(false),
    [rightOpen, setRightOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]),
    [showProjects, setShowProjects] = useState(false),
    [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false),
    [showWelcome, setShowWelcome] = useState(false),
    [loadingProjects, setLoadingProjects] = useState(false),
    [fullscreen, setFullscreen] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null),
    projectInput = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false),
    restored = useRef(false),
    busyRef = useRef(false),
    paletteRequest = useRef(0),
    navigationRequest = useRef(0);
  const dirty = state.changeVersion !== state.savedVersion;
  const isSaved = !dirty && !!state.projectId && saveStatus === "Сохранено";
  useEffect(() => {
    const detach = () => {
      store.getState().detachProject();
      localStorage.removeItem("ochen:last-project");
      history.replaceState({}, "", "/");
      setConflict(false);
      setSaveStatus("Не сохранено");
      setError(
        "Сессия браузера обновилась. Текущая работа сохранится как новый проект.",
      );
    };
    window.addEventListener("ochen:session-replaced", detach);
    return () => window.removeEventListener("ochen:session-replaced", detach);
  }, [store]);

  const registerPalette = useCallback(
    (loaded: Scene) => {
      const palette = canonicalPalette(loaded.palette, data.palettes);
      setPalettes((ps) => [...ps.filter((p) => p.id !== palette.id), palette]);
      return { ...loaded, palette };
    },
    [data.palettes],
  );

  const canLeave = () => {
    const current = store.getState();
    if (
      current.changeVersion !== current.savedVersion ||
      current.dragBaseline ||
      conflict
    ) {
      setShowProjects(false);
      setError(
        "Сначала сохраните текущий проект. При конфликте сохраните копию; JSON можно скачать как резервную копию.",
      );
      return false;
    }
    return true;
  };

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
        if (store.getState().documentEpoch === epoch) {
          setSaveStatus("Не сохранено");
          setError(errorMessage(e));
          if (e instanceof ApiError && e.status === 409) setConflict(true);
        }
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
    const snapshot = store.getState();
    const id =
      new URLSearchParams(location.search).get("project") ??
      localStorage.getItem("ochen:last-project");
    if (id)
      void api
        .project(id)
        .then((p) => {
          if (!unchanged(store, snapshot)) {
            setError(
              "Сцена изменилась во время загрузки. Ваши правки сохранены в редакторе.",
            );
            return;
          }
          store.getState().hydrate(registerPalette(p.scene), p.id, p.revision);
          setSaveStatus("Сохранено");
        })
        .catch(() => {
          if (!unchanged(store, snapshot)) return;
          localStorage.removeItem("ochen:last-project");
          setError(
            "Сохранённый проект недоступен в этой сессии. Открыта стартовая композиция.",
          );
        });
  }, [store, registerPalette]);

  useEffect(() => {
    if (!dirty || conflict || saving || busy || state.dragBaseline || locked)
      return;
    const timer = setTimeout(() => void save(), 1400);
    return () => clearTimeout(timer);
  }, [
    dirty,
    locked,
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
        busy ||
        showProjects ||
        locked
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
      } else if (mod && event.key.toLowerCase() === "c" && s.selected) {
        event.preventDefault();
        s.copySelection();
      } else if (mod && event.key.toLowerCase() === "v" && s.clipboard) {
        event.preventDefault();
        s.pasteSelection();
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
        if (s.selectedPart === "shadow" && selected.shadow) {
          const dx =
            event.key === "ArrowRight"
              ? delta
              : event.key === "ArrowLeft"
                ? -delta
                : 0;
          const dy =
            event.key === "ArrowDown"
              ? delta
              : event.key === "ArrowUp"
                ? -delta
                : 0;
          const asset = data.assets.find(
            (a) =>
              a.family === selected.family &&
              a.detail === s.scene.detail &&
              a.role === selected.role,
          );
          if (!asset) return;
          const frame = selectionFrame(
            selected,
            asset,
            s.scene.scale,
            "shadow",
          );
          const r = (-selected.angle * Math.PI) / 180;
          s.patchElement(
            selected.id,
            framePatch(frame, {
              ...frame.element,
              x:
                frame.element.x +
                (dx * Math.cos(r) - dy * Math.sin(r)) /
                  (s.scene.scale * (selected.scale_x ?? 1)),
              y:
                frame.element.y +
                (dx * Math.sin(r) + dy * Math.cos(r)) /
                  (s.scene.scale * (selected.scale_y ?? 1)),
            }),
          );
          return;
        }
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
  }, [store, save, busy, showProjects, locked, data.assets]);

  useEffect(() => {
    if (selected) setRightOpen(true);
  }, [selected]);
  useEffect(() => {
    if (locked) {
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
      paletteRequest.current++;
      setShowPalette(false);
      setShowWelcome(false);
      setShowHelp(false);
    }
  }, [locked]);
  useEffect(() => {
    if (
      locked ||
      showProjects ||
      showHelp ||
      showPalette ||
      busy ||
      state.dragBaseline ||
      document.cookie
        .split("; ")
        .some((c) => c.startsWith("ochen_welcome_seen="))
    )
      return;
    const timer = setTimeout(() => {
      document.cookie = `ochen_welcome_seen=1; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      setShowWelcome(true);
    }, 3500);
    return () => clearTimeout(timer);
  }, [
    locked,
    showProjects,
    showHelp,
    showPalette,
    busy,
    state.dragBaseline,
    state.changeVersion,
  ]);
  useEffect(() => {
    const update = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await workspace.current?.requestFullscreen();
      setZoom(1);
    } catch {
      setError(
        "Браузер не разрешил полноэкранный режим. Попробуйте открыть сайт в отдельной вкладке.",
      );
    }
  };
  useEffect(() => {
    if (showHelp) helpDialog.current?.showModal();
    else helpDialog.current?.close();
  }, [showHelp]);

  const generate = async () => {
    if (busyRef.current) return;
    if (!prompt.trim()) {
      setError("Опишите идею или перечислите предметы.");
      return;
    }
    const snapshot = store.getState();
    busyRef.current = true;
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
        use_ai: mode === "metaphor" && data.ai.configured,
      });
      if (!unchanged(store, snapshot)) {
        setError(
          "Сцена изменилась во время подбора. Ваши правки сохранены; запустите подбор ещё раз.",
        );
        return;
      }
      store.getState().change(result.scenes[0]);
      store.getState().select(null);
      setComposition(result);
      setVariantsOpen(true);
      setZoom(1);
      setLeftOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busyRef.current = false;
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
  const applyPalette = async (candidate: Palette) => {
    const requestId = ++paletteRequest.current,
      epoch = store.getState().documentEpoch;
    const validated = await api.validate({
      ...store.getState().scene,
      palette: candidate,
    });
    if (
      requestId !== paletteRequest.current ||
      epoch !== store.getState().documentEpoch
    )
      throw new Error("Документ изменился. Откройте палитру заново.");
    const palette = registerPalette(validated).palette;
    store.getState().change({ ...store.getState().scene, palette });
    setError("");
  };
  const importProject = async (file: File) => {
    if (!canLeave()) return;
    const snapshot = store.getState();
    const requestId = ++navigationRequest.current;
    try {
      if (file.size > 262144)
        throw new Error("Файл проекта слишком большой. Максимум 256 КБ.");
      const validated = await api.validate(JSON.parse(await file.text()));
      if (requestId !== navigationRequest.current) return;
      if (!unchanged(store, snapshot)) {
        setError(
          "Сцена изменилась во время импорта. Сначала сохраните правки.",
        );
        return;
      }
      store.getState().importScene(registerPalette(validated));
      localStorage.removeItem("ochen:last-project");
      history.replaceState({}, "", "/");
      setSaveStatus("Импортирован · сохраните проект");
      setConflict(false);
      setComposition(null);
      setError("");
    } catch (e) {
      if (
        requestId !== navigationRequest.current ||
        snapshot.documentEpoch !== store.getState().documentEpoch
      )
        return;
      setError(errorMessage(e));
    }
  };
  const openProject = async (id: string) => {
    if (!canLeave()) return;
    const snapshot = store.getState();
    const requestId = ++navigationRequest.current;
    try {
      const p = await api.project(id);
      if (requestId !== navigationRequest.current) return;
      if (!unchanged(store, snapshot)) {
        setShowProjects(false);
        setError(
          "Сцена изменилась во время загрузки. Сначала сохраните правки.",
        );
        return;
      }
      store.getState().hydrate(registerPalette(p.scene), p.id, p.revision);
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
      if (
        requestId !== navigationRequest.current ||
        snapshot.documentEpoch !== store.getState().documentEpoch
      )
        return;
      setError(errorMessage(e));
    }
  };
  const newProject = () => {
    if (!canLeave()) return;
    navigationRequest.current++;
    state.hydrate(defaultScene(data.palettes[0]));
    localStorage.removeItem("ochen:last-project");
    history.replaceState({}, "", "/");
    setSaveStatus("Не сохранено");
    setShowProjects(false);
    setComposition(null);
    setConflict(false);
  };
  useEffect(() => {
    if (leftOpen) leftPanelScroll.current?.scrollTo({ top: 0 });
  }, [leftOpen]);
  const showLibrary = () => {
    if (!leftOpen) {
      setRightOpen(false);
    }
    setLeftOpen(!leftOpen);
  };
  const openGallery = () => {
    setShowProjects(true);
    setShowWelcome(false);
    setLoadingProjects(true);
    void api
      .projects()
      .then(setProjects)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoadingProjects(false));
  };
  if (showProjects)
    return (
      <>
        <ProjectGallery
          projects={projects}
          assets={data.assets}
          sources={sources}
          loading={loadingProjects}
          onOpen={(id) => void openProject(id)}
          onNew={newProject}
          onBack={() => setShowProjects(false)}
        />
        {error && (
          <div className="gallery-error" role="alert">
            {error}
            <button
              onClick={() => {
                setError("");
                setShowProjects(false);
              }}
            >
              В редактор
            </button>
          </div>
        )}
      </>
    );

  return (
    <div
      className={`app-shell ${leftOpen ? "left-open" : ""} ${rightOpen ? "right-open" : ""}`}
    >
      <header className="app-header">
        <div className="header-project-actions">
          <a className="brand" href="/" aria-label="Сложено, главная">
            <span className="brand-mark">
              <i />
              <i />
              <i />
            </span>
            <h1>Сложено</h1>
          </a>
          <button
            className="text-button new-project-button"
            onClick={newProject}
            aria-label="Новый проект"
          >
            <Plus size={16} />
            <span>Новый проект</span>
          </button>
        </div>
        <div className="header-actions">
          <button
            className="text-button"
            onClick={openGallery}
            aria-label="Мои работы"
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
        </div>
      </header>
      <aside
        className="left-panel"
        id="idea-panel"
        aria-label="Идея и библиотека"
      >
        <div className="left-panel-heading">
          <h2>Идея и предметы</h2>
          <button
            className="icon"
            aria-label="Закрыть библиотеку"
            onClick={() => setLeftOpen(false)}
          >
            <X size={17} />
          </button>
        </div>
        <div className="left-panel-scroll" ref={leftPanelScroll}>
          <div className="prompt-section">
            <div className="section-title">
              <span className="eyebrow">НАЧНИТЕ С ИДЕИ</span>
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
              <span>
                {busy ? "Собираем композицию…" : "Собрать композицию"}
              </span>
              {!busy && <ArrowRight size={16} />}
            </button>
            <div className="generation-options">
              <label title="Добавляет в композицию дополнительные предметы заднего плана. Отключите, чтобы оставить только главные объекты.">
                <input
                  type="checkbox"
                  checked={backgrounds}
                  onChange={(e) => setBackgrounds(e.target.checked)}
                />
                Фоновые объекты
              </label>
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
        </div>
      </aside>
      <main className="workspace" ref={workspace}>
        <div className="document-toolbar">
          <label
            className="document-title"
            title="Нажмите, чтобы переименовать проект"
          >
            <span className="document-icon">
              <PencilLine size={16} />
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
          </label>
          <div className="document-actions">
            <button
              aria-label="Сохранить проект"
              disabled={saving}
              className={`save-status ${isSaved ? "is-saved" : "is-unsaved"}`}
              title={
                saving
                  ? "Сохранение выполняется"
                  : isSaved
                    ? "Все изменения сохранены · Ctrl / ⌘ + S"
                    : "Сохранить проект · Ctrl / ⌘ + S"
              }
              onClick={() => void save()}
            >
              <CheckCircle2 size={16} />
              <span role="status">
                {isSaved ? "Сохранено" : "Не сохранено"}
              </span>
            </button>
            <DownloadMenu
              onSVG={() => void exportSVG()}
              onJSON={exportProject}
              onImport={() => {
                if (canLeave()) projectInput.current?.click();
              }}
            />
          </div>
        </div>
        <div className="canvas-toolbar">
          <label className="canvas-preset">
            <span>Холст</span>
            <select
              aria-label="Размер холста"
              value={scene.format}
              onChange={(event) => {
                state.setFormat(event.target.value as Format, data.assets);
                setZoom(1);
              }}
            >
              {Object.entries(FORMAT_LABELS).map(([format, label]) => (
                <option key={format} value={format}>
                  {label}
                </option>
              ))}
            </select>
          </label>
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
            <div className="zoom-controls">
              <button
                className="icon"
                aria-label="Уменьшить масштаб просмотра"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
              >
                <ZoomOut size={15} />
              </button>
              <button
                className="zoom-reset"
                aria-label="Вписать в окно"
                title="Вписать в окно"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="icon"
                aria-label="Увеличить масштаб просмотра"
                onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              >
                <ZoomIn size={15} />
              </button>
              <button
                className="icon"
                aria-label={
                  fullscreen ? "Выйти из полного экрана" : "Полный экран"
                }
                aria-pressed={fullscreen}
                onClick={() => void toggleFullscreen()}
              >
                <Maximize size={13} />
              </button>
            </div>
          </div>
        </div>
        {composition && (
          <section
            className={`composition-bottom ${variantsOpen ? "is-expanded" : "is-collapsed"}`}
            aria-label="Варианты композиции"
          >
            <div
              id="composition-variants"
              className="variants"
              hidden={!variantsOpen}
            >
              <div className="section-title">
                <h2>Можно и так</h2>
                <span className="variants-count">3 варианта</span>
              </div>
              <div className="variant-grid">
                {composition.scenes.map((variant, i) => (
                  <button
                    key={i}
                    className="variant-card"
                    aria-label={`Вариант композиции ${i + 1}`}
                    onClick={() => {
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
                      });
                      setVariantsOpen(false);
                    }}
                  >
                    <span className="variant-number">0{i + 1}</span>
                    <svg
                      className="variant-preview"
                      viewBox={`0 0 ${FORMATS[variant.format].join(" ")}`}
                      aria-hidden="true"
                    >
                      <Illustration
                        scene={variant}
                        assets={data.assets}
                        sources={sources}
                        prefix={`variant-${i}`}
                      />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
            <button
              className="variants-toggle"
              aria-label={
                variantsOpen
                  ? "Скрыть варианты композиции"
                  : "Показать варианты композиции"
              }
              aria-expanded={variantsOpen}
              aria-controls="composition-variants"
              onClick={() => setVariantsOpen(!variantsOpen)}
            >
              {!variantsOpen && (
                <span>
                  Можно и так <small>3 варианта</small>
                </span>
              )}
              {variantsOpen ? (
                <ChevronDown size={18} />
              ) : (
                <ChevronUp size={18} />
              )}
            </button>
          </section>
        )}
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
      </main>
      <Inspector
        store={store}
        assets={data.assets}
        palettes={palettes}
        onImportPalette={() => setShowPalette(true)}
        onClose={() => setRightOpen(false)}
      />
      <nav className="mobile-panels" aria-label="Панели редактора">
        <button
          onClick={showLibrary}
          aria-expanded={leftOpen}
          aria-controls="idea-panel"
        >
          <PanelLeft size={17} />
          Идея и предметы
        </button>
        <button
          onClick={() => {
            setLeftOpen(false);
            setRightOpen(!rightOpen);
          }}
          aria-expanded={rightOpen}
          aria-controls="settings-panel"
        >
          <Settings2 size={17} />
          Настройки
        </button>
      </nav>
      <PaletteDialog
        open={showPalette}
        palette={scene.palette}
        onClose={() => {
          paletteRequest.current++;
          setShowPalette(false);
        }}
        onApply={applyPalette}
      />
      <WelcomeDialog open={showWelcome} onClose={() => setShowWelcome(false)} />
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
            Копировать предмет<kbd>⌘ / Ctrl + C</kbd>
          </span>
          <span>
            Вставить предмет<kbd>⌘ / Ctrl + V</kbd>
          </span>
          <span>
            Повторить действие<kbd>Shift + ⌘ / Ctrl + Z</kbd>
          </span>
          <span>
            Сохранить<kbd>⌘ / Ctrl + S</kbd>
          </span>
          <span>
            Удалить<kbd>Delete</kbd>
          </span>
        </div>
        <div className="help-gestures">
          <h3>Мышь и холст</h3>
          <p>
            <strong>Размер:</strong> тяните за угол рамки, чтобы сохранить
            пропорции. Боковые ручки растягивают по одной оси.
          </p>
          <p>
            <strong>Поворот:</strong> тяните круглую ручку над рамкой; Shift
            фиксирует шаг 15°. Стрелки у поля угла можно удерживать.
          </p>
          <p>
            <strong>Своя тень:</strong> включите режим в настройках и нажмите на
            тень, чтобы перемещать и менять её рамкой отдельно от предмета.
          </p>
          <p>
            <strong>Масштаб:</strong> кнопки лупы увеличивают и уменьшают холст.
            Колесо мыши и полосы прокрутки перемещают увеличенный холст; 100%
            вписывает его в окно.
          </p>
          <p>
            <strong>Панель над предметом:</strong> дублирование, порядок слоёв и
            удаление. Скачать SVG, сохранить JSON или открыть JSON можно через
            меню скачивания.
          </p>
        </div>
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
