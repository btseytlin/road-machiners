import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COLOR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i;
const PIXELS = /(?<![\w-])-?\d+(?:\.\d+)?px\b/g;
const HAIRLINE = new Set(["0px", "1px"]);
const GEOMETRY = /^(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block))?$|^(?:row-|column-)?gap$|^(?:min-|max-)?(?:width|height)$/;

interface CssScope {
  geometry: boolean;
}

const hasRawPixels = (value: string): boolean => (value.match(PIXELS) ?? []).some((px) => !HAIRLINE.has(px));

const PROPERTY_RULES: Record<string, (value: string) => boolean> = {
  "font-size": hasRawPixels,
  font: hasRawPixels,
  "border-radius": hasRawPixels,
  "font-family": (value) => !/^(?:var\(|inherit$)/.test(value),
  "z-index": (value) => /^-?\d+$/.test(value),
};

function declarations(css: string): { prop: string; value: string }[] {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...body.matchAll(/([a-z-]+)\s*:\s*([^;{}]+?)\s*(?=;|\})/gi)].map((m) => ({ prop: m[1]!.toLowerCase(), value: m[2]! }));
}

function violates(prop: string, value: string, scope: CssScope): boolean {
  if (COLOR.test(value)) return true;
  const rule = PROPERTY_RULES[prop];
  if (rule) return rule(value);
  return scope.geometry && GEOMETRY.test(prop) && hasRawPixels(value);
}

function cssViolations(css: string, scope: CssScope): string[] {
  return declarations(css)
    .filter((d) => violates(d.prop, d.value, scope))
    .map((d) => `${d.prop}: ${d.value}`);
}

function scriptViolations(source: string): string[] {
  const colors = [...source.matchAll(/(?<=['"`:\s(,])(?:#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/gi)].map((m) => m[0]);
  const fonts = [...source.matchAll(/(?<![\w$}-])\d+px\s+(?:sans-serif|serif|monospace)\b|font-size:\s*\d+px|fontSize\s*=\s*['"`]\d+px/g)].map((m) => m[0]);
  return [...colors, ...fonts];
}

const root = new URL("../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

describe("cssViolations", () => {
  it("flags raw colors anywhere", () => {
    expect(cssViolations(".a { color: #fff; }", { geometry: true })).toEqual(["color: #fff"]);
    expect(cssViolations(".a { box-shadow: 0 1px 0 rgba(0, 0, 0, 0.5); }", { geometry: false })).toHaveLength(1);
  });

  it("flags raw type, corners and layers", () => {
    expect(cssViolations(".a { font: 12px var(--font-mono); font-family: Arial; border-radius: 3px; z-index: 4; }", { geometry: true })).toEqual([
      "font: 12px var(--font-mono)",
      "font-family: Arial",
      "border-radius: 3px",
      "z-index: 4",
    ]);
  });

  it("flags raw spacing and sizes only where geometry is checked", () => {
    const css = ".a { padding: 4px var(--space-2); width: 300px; margin: -2px 0; }";
    expect(cssViolations(css, { geometry: true })).toEqual(["padding: 4px var(--space-2)", "width: 300px", "margin: -2px 0"]);
    expect(cssViolations(css, { geometry: false })).toEqual([]);
  });

  it("passes tokens, hairlines, zero, percentages and keywords", () => {
    const css =
      ".a { color: var(--ink); padding: 0 1px; gap: var(--space-2); width: calc(100% - var(--panel-s)); border-radius: 50%; z-index: var(--z-modal); background: transparent; font-size: inherit; }";
    expect(cssViolations(css, { geometry: true })).toEqual([]);
  });

  it("reads declarations inside media and keyframe blocks", () => {
    expect(cssViolations("@media (max-width: 720px) { .a { font-size: 7px; } }", { geometry: true })).toEqual(["font-size: 7px"]);
  });
});

describe("scriptViolations", () => {
  it("flags raw colors and pixel fonts in inline styles", () => {
    expect(scriptViolations("el.style.cssText = 'font:bold 11px sans-serif;color:#fff';")).toEqual(["#fff", "11px sans-serif"]);
    expect(scriptViolations('el.style.background = "rgba(20,18,14,0.9)";')).toEqual(["rgba(20,18,14,0.9)"]);
  });

  it("passes token references and computed geometry", () => {
    expect(scriptViolations("el.style.cssText = `left:${x}px;color:var(--ink)`;")).toEqual([]);
  });
});

const styleDir = "src/ui/styles/";
const drawings = new Set(["drawings.css"]);
const scripts = [
  ...readdirSync(new URL("src/ui/", root)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => `src/ui/${f}`),
  "src/three/crash.ts",
  "src/three/render/labels.ts",
  "src/three/render/weaponRange.ts",
  "src/three/render/fx.ts",
];

describe("the game's styles", () => {
  it("write no raw values outside tokens.css", () => {
    const found: string[] = [];
    for (const f of readdirSync(new URL(styleDir, root)).filter((f) => f.endsWith(".css")))
      for (const v of cssViolations(read(styleDir + f), { geometry: !drawings.has(f) })) found.push(`${f}: ${v}`);
    for (const v of cssViolations(read("src/ui/truck-condition.css"), { geometry: true })) found.push(`truck-condition.css: ${v}`);
    for (const v of cssViolations(read("src/ui/style.css"), { geometry: true })) found.push(`style.css: ${v}`);
    for (const v of cssViolations(read("index.html"), { geometry: true })) found.push(`index.html: ${v}`);
    for (const f of scripts) for (const v of scriptViolations(read(f))) found.push(`${f}: ${v}`);
    expect(found).toEqual([]);
  });
});
