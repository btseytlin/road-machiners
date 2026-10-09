import { baseGrid } from "../sim/grid";
import type { Vehicle } from "../sim/types";
import { el } from "./dom";
import { conditionLabel, TruckConditionReadout } from "./hud-readout";
import { tintedIcon, truckOutline } from "./plans";
import { PLAN_PAD } from "../render/partLooks";
import { token } from "./tokens";
import "./truck-condition.css";

const CELL = 30;

type ConditionPart = ReturnType<TruckConditionReadout["update"]>[number];
export type ConditionAim = { marks: ReadonlyMap<string, number[]>; pick: (partId: string) => void };

export class TruckConditionView {
  readonly root = el("div", {
    class: "truck-condition",
    "aria-label": "Truck part condition, nose up",
  });
  private body = el("div", { class: "condition-chassis" });
  private readout = new TruckConditionReadout();
  private nodes = new Map<string, HTMLElement>();
  private tip = el("div", { class: "condition-tip tooltip" });
  private hoverId: string | null = null;
  private tiles: ConditionPart[] = [];
  private outline: HTMLElement[] = [];
  private chassisId: string | null = null;

  constructor() {
    this.body.append(this.tip);
    this.root.append(this.body);
  }

  render(vehicle: Vehicle, aim?: ConditionAim): void {
    const grid = baseGrid(vehicle.chassisId);
    this.body.style.width = `${grid.w * CELL}px`;
    this.body.style.height = `${grid.h * CELL}px`;
    this.body.style.margin = `${PLAN_PAD * CELL}px 0`;
    if (this.chassisId !== vehicle.chassisId) {
      this.chassisId = vehicle.chassisId;
      for (const old of this.outline) old.remove();
      this.outline = [truckOutline(vehicle.chassisId, CELL), truckOutline(vehicle.chassisId, CELL)];
      this.outline[0].classList.add("outline-fill");
      this.outline[1].classList.add("outline-line");
      this.body.prepend(...this.outline);
    }
    const parts = this.readout.update(vehicle);
    const ids = new Set(parts.map((part) => part.id));
    for (const [id, node] of this.nodes) {
      if (ids.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
    }
    for (const part of parts) this.renderPart(part, aim);
    this.tiles = parts;
    this.showTip();
  }

  private showTip(): void {
    const part = this.tiles.find((p) => p.id === this.hoverId);
    this.tip.style.display = part ? "" : "none";
    if (!part) return;
    this.tip.replaceChildren(el("span", {}, part.name), el("span", { class: part.percent === 0 ? "num bad" : "num" }, part.percent === 0 ? "broken" : `${part.percent}%`));
    this.tip.style.left = `${part.x * CELL}px`;
    this.tip.style.top = `${part.y === 0 ? (part.y + part.h) * CELL + 2 : part.y * CELL - 22}px`;
  }

  private renderPart(part: ConditionPart, aim?: ConditionAim): void {
    let node = this.nodes.get(part.id);
    if (!node) {
      node = el("div", { class: "condition-part", "data-part-id": part.id }, tintedIcon(part.defId));
      this.nodes.set(part.id, node);
      this.body.append(node);
    }
    node.dataset.condition = part.state;
    node.classList.toggle("broken", part.broken);
    markAim(node, part.id, aim);
    node.setAttribute("aria-label", conditionLabel(part));
    node.onmouseenter = () => {
      this.hoverId = part.id;
      this.showTip();
    };
    node.onmouseleave = () => {
      if (this.hoverId === part.id) this.hoverId = null;
      this.showTip();
    };
    const tone = conditionTone(part.percent);
    node.style.cssText = `${boxStyle(part.x, part.y, part.w, part.h)};--tone:${tone.fill};--tint-line:${tone.shade};--tint-shadow:${tone.shade};--tint-light:${tone.light}`;
    if (part.hit) this.flashDamage(node);
  }

  private flashDamage(node: HTMLElement): void {
    for (const animation of node.getAnimations()) animation.cancel();
    node.animate(
      [
        { background: token("--alarm"), offset: 0 },
        { background: token("--alarm"), offset: 0.65 },
      ],
      { duration: 300, iterations: 2 },
    );
  }
}

function boxStyle(x: number, y: number, w: number, h: number): string {
  return `left:${x * CELL}px;top:${y * CELL}px;width:${w * CELL}px;height:${h * CELL}px`;
}

function markAim(node: HTMLElement, partId: string, aim?: ConditionAim): void {
  node.classList.toggle("aimable", aim !== undefined);
  node.onclick = aim ? () => aim.pick(partId) : null;
  node.querySelector(".condition-aim")?.remove();
  const guns = aim?.marks.get(partId);
  if (guns) node.append(el("span", { class: "condition-aim", title: `Aimed by gun ${guns.join(", ")}` }, guns.join(" ")));
}

type Tone = { fill: string; shade: string; light: string };
const BROKEN_TONE: Tone = { fill: token("--cond-broken-fill"), shade: token("--cond-broken-shade"), light: token("--cond-broken-light") };
const TONE_STOPS: readonly { at: number; rgb: readonly [number, number, number] }[] = [
  { at: 0, rgb: [128, 46, 38] },
  { at: 0.5, rgb: [140, 116, 48] },
  { at: 1, rgb: [62, 108, 66] },
];
const SHADE_DARKEN = 0.3;
const LIGHT_LIGHTEN = 0.25;

function conditionTone(percent: number): Tone {
  if (percent === 0) return BROKEN_TONE;
  const t = percent / 100;
  const i = TONE_STOPS.findIndex((s) => s.at >= t);
  const [a, b] = i <= 0 ? [TONE_STOPS[0], TONE_STOPS[0]] : [TONE_STOPS[i - 1], TONE_STOPS[i]];
  const k = b.at === a.at ? 0 : (t - a.at) / (b.at - a.at);
  const rgb = a.rgb.map((v, c) => v + (b.rgb[c] - v) * k);
  const hex = (mix: number): string =>
    `#${rgb.map((v) => Math.round(mix >= 0 ? v + (255 - v) * mix : v * (1 + mix)).toString(16).padStart(2, "0")).join("")}`;
  return { fill: hex(0), shade: hex(-SHADE_DARKEN), light: hex(LIGHT_LIGHTEN) };
}
