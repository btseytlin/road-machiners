import { baseGrid } from "../sim/grid";
import type { Vehicle } from "../sim/types";
import { createIcon } from "./cards";
import { el } from "./dom";
import { conditionLabel, openArmorSlots, TruckConditionReadout } from "./hud-readout";
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
  private slots = el("div", { class: "condition-slots" });
  private nodes = new Map<string, HTMLElement>();
  private tip = el("div", { class: "condition-tip" });
  private hoverId: string | null = null;
  private tiles: ConditionPart[] = [];

  constructor() {
    this.body.append(this.slots, this.tip);
    this.root.append(this.body);
  }

  render(vehicle: Vehicle, aim?: ConditionAim): void {
    const grid = baseGrid(vehicle.chassisId);
    this.body.style.width = `${grid.w * 30}px`;
    this.body.style.height = `${grid.h * 30}px`;
    const parts = this.readout.update(vehicle);
    const ids = new Set(parts.map((part) => part.id));
    for (const [id, node] of this.nodes) {
      if (ids.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
    }
    this.slots.replaceChildren(...openArmorSlots(vehicle).map(({ x, y }) =>
      el("div", { class: "condition-slot", style: `left:${x * CELL}px;top:${y * CELL}px;width:${CELL}px;height:${CELL}px` })));
    for (const part of parts) this.renderPart(part, aim);
    this.tiles = parts;
    this.showTip();
  }

  private showTip(): void {
    const part = this.tiles.find((p) => p.id === this.hoverId);
    this.tip.style.display = part ? "" : "none";
    if (!part) return;
    this.tip.textContent = conditionLabel(part);
    this.tip.style.left = `${part.x * CELL}px`;
    this.tip.style.top = `${part.y === 0 ? (part.y + part.h) * CELL + 2 : part.y * CELL - 22}px`;
  }

  private renderPart(part: ConditionPart, aim?: ConditionAim): void {
    let node = this.nodes.get(part.id);
    if (!node) {
      node = el(
        "div",
        { class: "condition-part", "data-part-id": part.id },
        el("span", { class: "condition-fill" }),
        createIcon(part.icon),
      );
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
    node.style.cssText = `left:${part.x * 30}px;top:${part.y * 30}px;width:${part.w * 30}px;height:${part.h * 30}px`;
    fillOf(node).style.height = `${part.percent}%`;
    if (part.hit) this.flashDamage(node);
  }

  private flashDamage(node: HTMLElement): void {
    for (const target of [node, fillOf(node)]) {
      for (const animation of target.getAnimations()) animation.cancel();
      target.animate(
        [
          { background: "#fa3934", borderColor: "#ffd1bd", offset: 0 },
          { background: "#fa3934", borderColor: "#ffd1bd", offset: 0.65 },
        ],
        { duration: 300, iterations: 2 },
      );
    }
  }
}


function markAim(node: HTMLElement, partId: string, aim?: ConditionAim): void {
  node.classList.toggle("aimable", aim !== undefined);
  node.onclick = aim ? () => aim.pick(partId) : null;
  node.querySelector(".condition-aim")?.remove();
  const guns = aim?.marks.get(partId);
  if (guns) node.append(el("span", { class: "condition-aim", title: `Aimed by gun ${guns.join(", ")}` }, guns.join(" ")));
}

function fillOf(node: HTMLElement): HTMLElement {
  const fill = node.querySelector<HTMLElement>(".condition-fill");
  if (!fill) throw new Error("Condition fill missing");
  return fill;
}
