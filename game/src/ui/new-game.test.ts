import { afterEach, describe, expect, it, vi } from "vitest";
import { WORLD_SETTINGS } from "../data/modes";
import type { BootRequest } from "../three/save-slots";
import { CONFIRM_NEW_GAME, isNewGameOpen, openNewGame } from "./new-game";

// Just enough DOM for the screen. Attributes, children, listeners, focus and removal.
class FakeNode {
  attrs: Record<string, string> = {};
  className = "";
  children: (FakeNode | string)[] = [];
  listeners = new Map<string, ((e: unknown) => void)[]>();
  parent: FakeNode | null = null;
  hidden = false;
  focused = 0;
  constructor(readonly tag: string) {}
  get textContent(): string { return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
  set textContent(text: string) { this.children = [text]; }
  append(...c: (FakeNode | string)[]) { for (const n of c) if (typeof n !== "string") n.parent = this; this.children.push(...c); }
  replaceChildren(...c: (FakeNode | string)[]) { this.children = []; this.append(...c); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; if (k === "hidden") this.hidden = true; }
  addEventListener(type: string, fn: (e: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: (e: unknown) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn)); }
  focus() { this.focused++; }
  fire(type: string, e: object = {}) { for (const f of this.listeners.get(type) ?? []) f({ stopPropagation: () => {}, ...e }); }
  all(pred: (n: FakeNode) => boolean): FakeNode[] {
    return [...(pred(this) ? [this] : []), ...this.children.flatMap((c) => (typeof c === "string" ? [] : c.all(pred)))];
  }
  button(text: string): FakeNode {
    const found = this.all((n) => n.tag === "button" && n.textContent.includes(text))[0];
    if (!found) throw new Error(`No ${text} button`);
    return found;
  }
  slider(id: string): FakeNode {
    const found = this.all((n) => n.tag === "input" && n.attrs.id === `setting-${id}`)[0];
    if (!found) throw new Error(`No ${id} slider`);
    return found;
  }
}

// Storage that records every write, so a test can show nothing was written.
function spyStorage() {
  return { setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), getItem: vi.fn(() => null) };
}

let last: FakeNode | null = null;

function open(confirmed = true) {
  const ui = new FakeNode("div");
  const win = new FakeNode("window");
  const opener = new FakeNode("button");
  const local = spyStorage();
  const session = spyStorage();
  vi.stubGlobal("document", { createElement: (t: string) => new FakeNode(t), getElementById: () => ui, activeElement: opener });
  vi.stubGlobal("window", Object.assign(win, { localStorage: local, sessionStorage: session }));
  const requests: BootRequest[] = [];
  const actions = { requestBoot: (r: BootRequest) => requests.push(r), reload: vi.fn(), confirm: vi.fn(() => confirmed) };
  const onClose = vi.fn();
  openNewGame(actions, onClose);
  const screen = ui.all((n) => n.className.split(" ").includes("new-game"))[0];
  last = screen;
  const slide = (id: string, value: number) => {
    const input = screen.slider(id);
    input.fire("input", { target: { value: String(value) } });
  };
  const wroteStorage = () => [local, session].some((s) => s.setItem.mock.calls.length + s.removeItem.mock.calls.length + s.clear.mock.calls.length > 0);
  return { ui, win, screen, opener, actions, requests, onClose, slide, wroteStorage };
}

describe("the New game screen", () => {
  afterEach(() => {
    if (isNewGameOpen()) last?.button("Back").fire("click");
    vi.unstubAllGlobals();
  });

  it("shows the title, a selected Roaming card with its description, World Settings, Back and Start, with focus on Start", () => {
    const { screen } = open();
    const roaming = screen.all((n) => n.attrs["data-mode"] === "roaming")[0];

    expect(screen.textContent).toContain("New game");
    expect(roaming.attrs["aria-checked"]).toBe("true");
    expect(roaming.textContent).toContain("The open wasteland");
    expect(screen.button("World Settings")).toBeDefined();
    expect(screen.button("Back")).toBeDefined();
    expect(screen.button("Start").focused).toBe(1);
  });

  it("expands World Settings inline with a row per setting at its default and bounds", () => {
    const { screen } = open();
    const section = screen.all((n) => n.className === "world-settings")[0];
    expect(section.hidden).toBe(true);
    screen.button("World Settings").fire("click");

    expect(section.hidden).toBe(false);
    for (const [id, def] of Object.entries(WORLD_SETTINGS)) {
      const slider = screen.slider(id);
      expect([slider.attrs.min, slider.attrs.max, slider.attrs.step, slider.attrs.value]).toEqual([def.min, def.max, def.step, def.default].map(String));
      const row = screen.all((n) => n.attrs["data-setting"] === id)[0];
      expect(row.textContent).toContain(def.name);
      expect(row.textContent).toContain("100%default 100%");
    }
  });

  it("writes nothing and calls no command when opened and closed with Back, and gives focus back", () => {
    const { screen, ui, requests, actions, wroteStorage, onClose, opener } = open();
    screen.button("Back").fire("click");

    expect(requests).toEqual([]);
    expect(actions.reload).not.toHaveBeenCalled();
    expect(wroteStorage()).toBe(false);
    expect(ui.children).toEqual([]);
    expect(isNewGameOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener.focused).toBe(1);
  });

  it("leaves nothing after a changed slider and Back", () => {
    const { screen, slide, requests, wroteStorage } = open();
    slide("damage", 1.5);
    expect(screen.all((n) => n.attrs["data-setting"] === "damage")[0].textContent).toContain("150%");
    screen.button("Back").fire("click");

    expect(requests).toEqual([]);
    expect(wroteStorage()).toBe(false);
  });

  it("closes on Escape and writes nothing", () => {
    const { win, requests, onClose } = open();
    win.fire("keydown", { code: "Escape" });

    expect(isNewGameOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([]);
  });

  it("keeps the keys typed in the screen out of the game", () => {
    const { screen } = open();
    const stop = vi.fn();
    screen.fire("keydown", { code: "KeyC", stopPropagation: stop });

    expect(stop).toHaveBeenCalled();
  });

  it("restores every default on Reset to defaults", () => {
    const { screen, slide, requests } = open();
    slide("damage", 2);
    slide("fuelUse", 0.5);
    screen.button("Reset to defaults").fire("click");
    screen.button("Start").fire("click");

    expect(requests).toEqual([{ new: { mode: "roaming", settings: { damage: 1, fuelUse: 1, supplyUse: 1 } } }]);
  });

  it("asks before Start and stays open with nothing written when the player says no", () => {
    const { screen, slide, requests, actions, wroteStorage } = open(false);
    slide("damage", 1.5);
    screen.button("Start").fire("click");

    expect(actions.confirm).toHaveBeenCalledWith(CONFIRM_NEW_GAME);
    expect(requests).toEqual([]);
    expect(actions.reload).not.toHaveBeenCalled();
    expect(wroteStorage()).toBe(false);
    expect(isNewGameOpen()).toBe(true);
  });

  it("leaves exactly one request with the picked values and reloads on a confirmed Start", () => {
    const { screen, slide, requests, actions } = open(true);
    slide("damage", 1.5);
    slide("fuelUse", 2);
    screen.button("Start").fire("click");

    expect(requests).toEqual([{ new: { mode: "roaming", settings: { damage: 1.5, fuelUse: 2, supplyUse: 1 } } }]);
    expect(actions.reload).toHaveBeenCalledTimes(1);
  });

  it("refuses to start with a value off the slider's grid", () => {
    const { screen, slide, requests } = open(true);
    slide("supplyUse", 1.1);

    expect(() => screen.button("Start").fire("click")).toThrow(/supplyUse/);
    expect(requests).toEqual([]);
  });
});
