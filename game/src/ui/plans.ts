// Truck outlines and tinted part icons drawn from symbols that join the page once. A truck outline is the chassis plan
// from npm run icons, stretched over its grid. A tinted part icon takes its colors from the CSS variables --tint-*.

import { baseGrid } from "../sim/grid";
import { PLAN_PAD } from "../render/partLooks";
import PLANS from "../../public/icons/plans.svg?raw";
import TINTS from "../../public/icons/tint.svg?raw";
import { el } from "./dom";

const SVG_NS = "http://www.w3.org/2000/svg";

let sheetsLoaded = false;
function loadSheets(): void {
  if (sheetsLoaded) return;
  sheetsLoaded = true;
  document.body.insertAdjacentHTML("beforeend", PLANS + TINTS);
}

export function truckOutline(chassisId: string, cell: number): HTMLElement {
  const grid = baseGrid(chassisId);
  const box = el("div", { class: "truck-outline", "aria-hidden": "true" }, useSvg(`plan-${chassisId}`, true));
  const [x, y, w, h] = [1 - PLAN_PAD, -PLAN_PAD, grid.w - 2 + 2 * PLAN_PAD, grid.h + 2 * PLAN_PAD].map((v) => v * cell);
  box.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
  return box;
}

export function tintedIcon(defId: string): SVGSVGElement {
  return useSvg(`tint-${defId}`, false);
}

function useSvg(id: string, stretch: boolean): SVGSVGElement {
  loadSheets();
  const svg = document.createElementNS(SVG_NS, "svg");
  if (stretch) {
    svg.setAttribute("viewBox", "0 0 1 1");
    svg.setAttribute("preserveAspectRatio", "none");
  }
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${id}`);
  use.setAttribute("width", stretch ? "1" : "100%");
  use.setAttribute("height", stretch ? "1" : "100%");
  svg.append(use);
  return svg;
}
