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
    expect(button.attrs.get("aria-disabled")).toBe("true");
    expect(button.attrs.get("data-reason")).toMatch(/XP/);
  });

  it("prints a rank price as one plain phrase", () => {
    const world = emptyWorld();
    world.player.xp = 1000;
    const button = rankButtons(openCharacter(world))[0];
    expect(button.text()).toMatch(/^Buy \d+ XP$/);
    expect(button.attrs.has("aria-disabled")).toBe(false);
  });

  it("has one row per skill and says today and the cap once", () => {
    const root = openCharacter(emptyWorld());
    expect(root.all((n) => n.className.includes("skill-row"))).toHaveLength(5);
    expect(root.text().match(/Today/g)).toHaveLength(1);
    expect(root.text()).toContain("max 150 XP");
    expect(root.all((n) => n.className === "skill-name")[0].attrs.get("title")).toMatch(/^Earns XP from /);
  });

  it("marks a row with an open perk pair and shows both perks as buttons", () => {
    const world = emptyWorld();
    world.player.ranks.driving = 2;
    const root = openCharacter(world);
    const pending = root.all((n) => n.className.includes("pending"));
    expect(pending).toHaveLength(1);
    expect(pending[0].all((n) => n.tag === "button" && n.className.includes("perk"))).toHaveLength(2);
  });

  it("blocks a perk pick while knocked out and says why", () => {
    const world = emptyWorld();
    world.player.ranks.driving = 2;
    world.player.state = "knockedOut";
    const perk = openCharacter(world).all((n) => n.tag === "button" && n.className === "perk")[0];
    expect(perk.attrs.get("aria-disabled")).toBe("true");
    expect(perk.attrs.get("data-reason")).toBe("You are knocked out");
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
