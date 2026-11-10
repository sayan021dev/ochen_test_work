import type { Bootstrap, Composition, Palette, Project, Scene } from "./types";

let csrf = "";
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new ApiError(
      "Нет связи с сервером. Изменения остаются в редакторе.",
      0,
    );
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth"))
      window.dispatchEvent(new Event("ochen:auth-required"));
    const result = await response
      .json()
      .catch(() => ({ detail: "Сервис временно недоступен" }));
    throw new ApiError(
      typeof result.detail === "string"
        ? result.detail
        : "Проверьте введённые данные",
      response.status,
    );
  }
  return response.json();
}
export const api = {
  auth: async () => {
    const result = await request<{
      required: boolean;
      authenticated: boolean;
      csrf_token: string;
    }>("/auth");
    csrf = result.csrf_token;
    return result;
  },
  login: async (password: string) => {
    const previous = csrf;
    await api.auth();
    await request("/auth/login", "POST", { password });
    return { sessionChanged: !!previous && previous !== csrf };
  },
  logout: () => request("/auth/logout", "POST", {}),
  bootstrap: async () => {
    const result = await request<Bootstrap>("/bootstrap");
    csrf = result.csrf_token;
    return result;
  },
  compose: (data: {
    prompt: string;
    mode: "metaphor" | "components";
    format: Scene["format"];
    detail: Scene["detail"];
    palette: Palette;
    seed: number;
    backgrounds: boolean;
    use_ai: boolean;
    light?: Scene["light"];
  }) => request<Composition>("/compose", "POST", data),
  projects: () => request<Project[]>("/projects"),
  project: (id: string) =>
    request<Project>(`/projects/${encodeURIComponent(id)}`),
  save: (scene: Scene, id: string | null, revision: number) =>
    request<Project>(
      id ? `/projects/${encodeURIComponent(id)}` : "/projects",
      id ? "PUT" : "POST",
      { scene, revision },
    ),
  validate: (scene: unknown) => request<Scene>("/validate", "POST", scene),
  export: async (scene: Scene) => {
    const response = await fetch("/api/export", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(scene),
    });
    if (!response.ok) {
      if (response.status === 401)
        window.dispatchEvent(new Event("ochen:auth-required"));
      throw new ApiError("Не удалось экспортировать SVG", response.status);
    }
    return response.blob();
  },
};

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
