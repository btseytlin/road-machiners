import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONDITION } from "../data/wear";
import type { PartInstance } from "../sim/types";
import { conditionTier } from "./format";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function colorOf(tier: string): string {
  const m = css.match(new RegExp(`\\.cond-${tier}\\s*\\{[^}]*?\\bcolor:\\s*(#[0-9a-fA-F]{6}|var\\(--[a-z-]+\\))`));
  if (!m) throw new Error(`no .cond-${tier} color in style.css`);
  const v = m[1]!.match(/^var\((--[a-z-]+)\)$/);
  return v ? css.match(new RegExp(`${v[1]}:\\s*(#[0-9a-fA-F]{6})`))![1]! : m[1]!;
}

const ink = css.match(/--ink:\s*(#[0-9a-fA-F]{6})/)![1]!;
const tiers = Array.from({ length: CONDITION.maxWear + 2 }, (_, wear) =>
  conditionTier({ id: "p", defId: "mg", hp: 1, wear } as PartInstance),
);

describe("condition colors", () => {
  it("has a color for every tier", () => {
    for (const t of tiers) expect(colorOf(t)).toMatch(/^#/);
  });

  it("falls in brightness from pristine through each rebuild to junk", () => {
    const lums = tiers.map((t) => luminance(colorOf(t)));
    for (let i = 1; i < lums.length; i++) expect(lums[i]).toBeLessThan(lums[i - 1]!);
  });

  it("makes pristine brighter than normal text", () => {
    expect(luminance(colorOf("pristine"))).toBeGreaterThan(luminance(ink));
  });

  it("keeps every tier readable on the card and panel backgrounds", () => {
    for (const t of tiers)
      for (const bg of ["#22292d", "#272b2e"]) expect(contrast(colorOf(t), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("fills the pristine star", () => {
    expect(css).toMatch(/\.cond-pristine \.icon svg\s*\{[^}]*fill:/);
  });
});
