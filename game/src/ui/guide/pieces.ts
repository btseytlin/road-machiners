import { el } from "../dom";

export interface Piece {
  name: string;
  note: string;
  build: () => HTMLElement;
}

const text = (tag: string, cls: string, words: string): HTMLElement => el(tag, { class: cls }, words);

const sample = (cls: string, words: string): HTMLElement => el("div", { class: cls }, words);

export const PIECES: Piece[] = [
  { name: ".panel", note: "The base of every HUD box.", build: () => sample("panel", "A panel") },
  { name: ".dialog", note: "The frame of a modal, the save panel and New game.", build: () => sample("dialog", "A dialog") },
  { name: ".dock-panel", note: "A panel of the right dock.", build: () => sample("dock-panel", "A dock panel") },
  { name: ".notice", note: "A box at the top middle that waits for a choice.", build: () => sample("notice panel", "A notice") },
  { name: ".panel-title", note: "The heading of a small HUD panel.", build: () => text("h3", "panel-title", "Title") },
  { name: "button", note: "The default button.", build: () => text("button", "", "Button") },
  { name: ".btn-s", note: "A small button, 24px high, for rows, cards and small panels.", build: () => text("button", "btn-s", "Small") },
  { name: ".btn-l", note: "A large button, 44px high, for a screen's main choice.", build: () => text("button", "btn-l", "Large") },
  { name: ".btn-danger", note: "A hostile action.", build: () => text("button", "btn-danger", "Danger") },
  { name: ".row", note: "A list line with a faint line under it.", build: () => sample("row", "A row") },
  { name: ".tile", note: "A boxed list item edged in its tone.", build: () => sample("tile", "A tile") },
  { name: ".chip", note: "A small boxed value.", build: () => text("span", "chip", "120 scrap") },
  { name: ".tag", note: "An outlined word.", build: () => text("span", "tag", "buy") },
  { name: ".meter", note: "A bar that fills from the left.", build: () => meter("meter", 70) },
  { name: ".meter.progress", note: "A bar for timed work.", build: () => meter("meter progress", 40) },
  { name: ".meter.broken", note: "A bar of a broken part.", build: () => meter("meter broken", 100) },
  { name: ".tooltip", note: "A note that opens over its anchor.", build: () => sample("tooltip", "Load: -10 km/h") },
  { name: ".num", note: "A number in the mono face.", build: () => text("span", "num", "1 240") },
];

function meter(cls: string, percent: number): HTMLElement {
  const fill = el("span", {});
  fill.style.width = `${percent}%`;
  return el("div", { class: cls }, fill);
}
