import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyWorld } from "../sim/testkit";
import type { World } from "../sim/types";
import { CharacterScreen } from "./character";
import { truckChips } from "./inventory";

class FakeNode {
  className = "";
  innerHTML = "";
  style = { display: "" };
  classList = { add: (c: string) => { this.className += ` ${c}`; } };
  children: (FakeNode | string)[] = [];
  attrs = new Map<string, string>();
  constructor(readonly tag: string) {}
  append(...c: (FakeNode | string)[]) { this.children.push(...c); }
  replaceChildren(...c: (FakeNode | string)[]) { this.children = c; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  addEventListener() {}
  text(): string { return this.children.map((c) => (typeof c === "string" ? c : c.text())).join(""); }
  all(pred: (n: FakeNode) => boolean): FakeNode[] {
    const here = pred(this) ? [this] : [];
    return [...here, ...this.children.flatMap((c) => (typeof c === "string" ? [] : c.all(pred)))];
  }
}

const ui = new FakeNode("div");

function stubDom(): void {
  vi.stubGlobal("document", { createElement: (t: string) => new FakeNode(t), getElementById: () => ui });
  vi.stubGlobal("window", { addEventListener: () => {} });
}

function openCharacter(world: World): FakeNode {
  stubDom();
  const screen = new CharacterScreen({ world: () => world, apply: () => {}, announce: () => {} } as never);
  screen.toggle();
  return ui.children[ui.children.length - 1] as FakeNode;
}

const rankButtons = (root: FakeNode) => root.all((n) => n.className.includes("buy-rank"));

describe("character screen", () => {
  afterEach(() => {
    ui.children = [];
    vi.unstubAllGlobals();
  });

  it("gives a disabled rank button its reason", () => {
    const root = openCharacter(emptyWorld());
    const button = rankButtons(root)[0];
    expect(button.attrs.get("disabled")).toBe("");
    expect(button.attrs.get("title")).toMatch(/XP/);
  });

  it("prints a rank price as one plain phrase", () => {
    const world = emptyWorld();
    world.player.xp = 1000;
    const button = rankButtons(openCharacter(world))[0];
    expect(button.text()).toMatch(/^Buy rank 1 for \d+ XP$/);
    expect(button.attrs.has("disabled")).toBe(false);
  });

  it("prints the XP pool as a number and a unit", () => {
    const world = emptyWorld();
    world.player.xp = 300.7;
    expect(openCharacter(world).all((n) => n.className.includes("xp-pool"))[0].text()).toBe("300 XP");
  });
});

describe("inventory header money", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prints money as the M's coin and the number", () => {
    stubDom();
    const world = emptyWorld();
    world.player.money = 3300;
    const chips = truckChips(world) as unknown as FakeNode;
    const money = chips.all((n) => n.className.split(" ").includes("amount"))[0];
    expect((money.children[0] as FakeNode).className).toBe("coin");
    expect(money.text()).toBe("33");
  });

  it("prints debt as a negative amount in danger ink", () => {
    stubDom();
    const world = emptyWorld();
    world.player.money = -3300;
    const chips = truckChips(world) as unknown as FakeNode;
    const money = chips.all((n) => n.className.split(" ").includes("amount"))[0];
    expect(money.className).toContain("bad");
    expect(money.text()).toBe("−33");
  });
});
