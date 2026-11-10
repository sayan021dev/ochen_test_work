import { afterEach, beforeAll, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { PaletteDialog } from "./PaletteDialog";
import { PasswordGate } from "./PasswordGate";
import { ProjectGallery } from "./ProjectGallery";
import { WelcomeDialog } from "./WelcomeDialog";
import type { Palette, Project } from "./types";
import { defaultScene } from "./state";

const palette: Palette = {
  id: "test",
  name: "Исходная",
  background: ["#FFFFFF", "#EEEEEE", "#AAAAAA", "#111111"],
  object: ["#FF68A4", "#FFAAAA", "#AAFFFF", "#FFCC00"],
};
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);

it("edits a palette draft without changing the current palette before applying", async () => {
  let applied: Palette | undefined;
  const view = render(
    <PaletteDialog
      open
      palette={palette}
      onClose={() => {}}
      onApply={async (value) => {
        applied = value;
      }}
    />,
  );
  fireEvent.change(view.getByLabelText("HEX фона 1"), {
    target: { value: "#123456" },
  });
  expect(palette.background[0]).toBe("#FFFFFF");
  expect(applied).toBeUndefined();
  fireEvent.click(view.getByRole("button", { name: "Применить палитру" }));
  await waitFor(() => expect(applied?.background[0]).toBe("#123456"));
});

it("shows an import error inside the dialog and keeps the existing draft", async () => {
  const view = render(
    <PaletteDialog
      open
      palette={palette}
      onClose={() => {}}
      onApply={async () => {}}
    />,
  );
  fireEvent.click(view.getByRole("tab", { name: "Импорт JSON" }));
  const file = new File(["not json"], "bad.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => "not json" });
  fireEvent.change(view.getByLabelText("Импорт палитры"), {
    target: { files: [file] },
  });
  expect(await view.findByRole("alert")).toBeTruthy();
  fireEvent.click(view.getByRole("tab", { name: "Создать палитру" }));
  expect((view.getByLabelText("HEX фона 1") as HTMLInputElement).value).toBe(
    "#FFFFFF",
  );
});

it("keeps failed validation visible without closing the palette dialog", async () => {
  let closed = false;
  const view = render(
    <PaletteDialog
      open
      palette={palette}
      onClose={() => {
        closed = true;
      }}
      onApply={async () => {
        throw new Error("Палитра не прошла проверку");
      }}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Применить палитру" }));
  expect((await view.findByRole("alert")).textContent).toContain(
    "Палитра не прошла проверку",
  );
  expect(closed).toBe(false);
});

it("ignores an old apply completion after the palette dialog is reopened", async () => {
  let finish!: () => void;
  let closes = 0;
  const onApply = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const props = {
    palette,
    onApply,
    onClose: () => {
      closes += 1;
    },
  };
  const view = render(<PaletteDialog {...props} open />);
  fireEvent.click(view.getByRole("button", { name: "Применить палитру" }));
  view.rerender(<PaletteDialog {...props} open={false} />);
  view.rerender(<PaletteDialog {...props} open />);
  await act(async () => finish());
  expect(closes).toBe(0);
  expect(view.getByRole("dialog")).toBeTruthy();
});

it("rejects incomplete HEX colors before applying", async () => {
  let applied = false;
  const view = render(
    <PaletteDialog
      open
      palette={palette}
      onClose={() => {}}
      onApply={async () => {
        applied = true;
      }}
    />,
  );
  fireEvent.change(view.getByLabelText("HEX объекта 2"), {
    target: { value: "#12" },
  });
  fireEvent.click(view.getByRole("button", { name: "Применить палитру" }));
  expect(await view.findByRole("alert")).toBeTruthy();
  expect(applied).toBe(false);
});

it("clears a rejected password and allows retry", async () => {
  const attempts: string[] = [];
  const view = render(
    <PasswordGate
      onLogin={async (password) => {
        attempts.push(password);
        throw new Error("Неверный пароль");
      }}
    />,
  );
  const input = view.getByLabelText("Пароль доступа") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "wrong" } });
  fireEvent.click(view.getByRole("button", { name: "Войти" }));
  expect(await view.findByRole("alert")).toBeTruthy();
  expect(input.value).toBe("");
  expect(attempts).toEqual(["wrong"]);
});

it("renders editable SVG project previews with separate ID namespaces", () => {
  const scene = defaultScene(palette);
  const projects: Project[] = ["a", "b"].map((id) => ({
    id,
    scene,
    revision: 1,
    updated_at: "2026-11-10T12:00:00Z",
  }));
  const view = render(
    <ProjectGallery
      projects={projects}
      assets={[]}
      sources={{}}
      loading={false}
      onOpen={() => {}}
      onNew={() => {}}
      onBack={() => {}}
    />,
  );
  const ids = [...view.container.querySelectorAll("clipPath")].map(
    (node) => node.id,
  );
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(view.getAllByRole("button", { name: /Открыть проект/ })).toHaveLength(
    2,
  );
});

it("associates welcome guidance with the accessible dialog description", () => {
  const view = render(<WelcomeDialog open onClose={() => {}} />);
  const dialog = view.getByRole("dialog", { name: "У каждой идеи есть форма" });
  const descriptionId = dialog.getAttribute("aria-describedby");
  expect(descriptionId).toBeTruthy();
  expect(document.getElementById(descriptionId!)?.textContent).toBe(
    "Соберите её из готовых векторных объектов.",
  );
});

it("keeps the editor home link and both project actions available in the gallery header", () => {
  const actions: string[] = [];
  const view = render(
    <ProjectGallery
      projects={[]}
      assets={[]}
      sources={{}}
      loading={false}
      onOpen={() => {}}
      onNew={() => actions.push("new")}
      onBack={() => actions.push("back")}
    />,
  );
  const home = view.getByRole("link", { name: "Сложено, главная" });
  expect(home.getAttribute("href")).toBe("/");
  fireEvent.click(view.getByRole("button", { name: "В редактор" }));
  fireEvent.click(view.getByRole("button", { name: "Новый проект" }));
  expect(actions).toEqual(["back", "new"]);
});
