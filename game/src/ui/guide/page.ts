import "../style.css";
import "./guide.css";
import { el, uiRoot } from "../dom";
import { TOKENS } from "../tokens";
import { PIECES } from "./pieces";

type Sample = (name: string) => HTMLElement;

interface Group {
  title: string;
  prefixes: string[];
  sample: Sample;
}

const swatch: Sample = (name) => {
  const box = el("div", { class: "guide-swatch" });
  box.style.background = `var(${name})`;
  return box;
};

const typeSample: Sample = (name) => {
  const line = el("div", {}, "Wasteland truck 0123");
  line.style.fontSize = `var(${name})`;
  line.style.fontFamily = "var(--font-ui)";
  return line;
};

const fontSample: Sample = (name) => {
  const line = el("div", {}, "Wasteland truck 0123");
  line.style.fontFamily = `var(${name})`;
  return line;
};

const spaceSample: Sample = (name) => {
  const bar = el("div", { class: "guide-bar" });
  bar.style.width = `var(${name})`;
  return bar;
};

const boxSample: Sample = (name) => {
  const box = el("div", { class: "guide-box" });
  box.style.width = `var(${name}, 0px)`;
  box.style.height = `var(--space-8)`;
  return box;
};

const radiusSample: Sample = (name) => {
  const box = el("div", { class: "guide-box" });
  box.style.height = `var(--space-9)`;
  box.style.borderRadius = `var(${name})`;
  return box;
};

const zSample: Sample = (name) => el("div", {}, `layer ${TOKENS.get(name)}`);

const GROUPS: Group[] = [
  { title: "Fonts", prefixes: ["--font-"], sample: fontSample },
  { title: "Type", prefixes: ["--text-"], sample: typeSample },
  { title: "Surfaces", prefixes: ["--color-", "--surface-", "--scrim"], sample: swatch },
  { title: "Lines", prefixes: ["--line"], sample: swatch },
  { title: "Text", prefixes: ["--ink"], sample: swatch },
  { title: "Accent", prefixes: ["--accent", "--select"], sample: swatch },
  { title: "Danger", prefixes: ["--danger", "--alarm", "--crash"], sample: swatch },
  { title: "Good", prefixes: ["--good"], sample: swatch },
  { title: "Path preview", prefixes: ["--path-"], sample: swatch },
  { title: "Condition", prefixes: ["--cond-"], sample: swatch },
  { title: "Grid cells", prefixes: ["--cell-", "--map-"], sample: swatch },
  { title: "Marks", prefixes: ["--mark-"], sample: swatch },
  { title: "Hardware", prefixes: ["--steel-", "--lcd", "--dial-tick", "--dial-pin"], sample: swatch },
  { title: "Light and shade", prefixes: ["--bevel-", "--shade", "--shadow-", "--vignette", "--storm-"], sample: swatch },
  { title: "Spacing", prefixes: ["--space-"], sample: spaceSample },
  { title: "Corners", prefixes: ["--radius-"], sample: radiusSample },
  { title: "Button heights", prefixes: ["--btn-"], sample: spaceSample },
  { title: "Icon and bar sizes", prefixes: ["--icon-", "--meter-", "--pip"], sample: spaceSample },
  { title: "Panel sizes", prefixes: ["--panel-", "--dock-", "--modal-"], sample: boxSample },
  {
    title: "Screen sizes",
    prefixes: ["--tab-", "--tip-", "--inv-", "--col-", "--card-", "--portrait-", "--log-", "--marker-", "--narrow-", "--dial-size"],
    sample: boxSample,
  },
  { title: "HUD placement", prefixes: ["--hud-"], sample: spaceSample },
  { title: "Layers", prefixes: ["--z-"], sample: zSample },
];

function cell(name: string, sample: Sample): HTMLElement {
  return el("div", { class: "guide-cell" }, sample(name), el("span", {}, name), el("small", {}, TOKENS.get(name) ?? ""));
}

function section(group: Group): HTMLElement {
  const names = [...TOKENS.keys()].filter((n) => group.prefixes.some((p) => n.startsWith(p)));
  return el("section", {}, el("h2", {}, group.title), el("div", { class: "guide-grid" }, ...names.map((n) => cell(n, group.sample))));
}

function pieces(): HTMLElement {
  const cells = PIECES.map((p) => el("div", { class: "guide-cell" }, p.build(), el("span", {}, p.name), el("small", {}, p.note)));
  return el("section", {}, el("h2", {}, "Shared pieces"), el("div", { class: "guide-grid" }, ...cells));
}

function ungrouped(): string[] {
  const prefixes = GROUPS.flatMap((g) => g.prefixes);
  return [...TOKENS.keys()].filter((n) => !prefixes.some((p) => n.startsWith(p)));
}

function render(): void {
  const missed = ungrouped();
  if (missed.length > 0) throw new Error(`ui.html shows no group for: ${missed.join(", ")}`);
  const root = uiRoot();
  root.classList.add("guide");
  root.append(el("h1", {}, "Road Machiners UI guide"), ...GROUPS.map(section), pieces());
}

render();
