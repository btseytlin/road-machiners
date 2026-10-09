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

const BUTTON_SELECTOR = /(?<![\w-])button\b|\.close\b|\.btn-/;
const BUTTON_GEOMETRY = /^(?:min-|max-)?height$|^padding(?:-[a-z]+)?$|^font(?:-size)?$|^line-height$/;

interface ButtonRules {
  button: RegExp;
  selfSizing: RegExp;
}

const classes = (names: string[]): RegExp => new RegExp(`(?:${names.map((n) => n.replace(".", "\\.")).join("|")})(?![\\w-])`);

function buttonRules(components: string): ButtonRules {
  const list = components.match(/:where\(:not\(([^)]*)\)\)/)?.[1];
  if (!list) throw new Error("components.css lost its list of self-sizing buttons");
  const sized = [...components.matchAll(/#ui :is\(([^)]*)\)/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim()).filter((s) => /^\.[\w-]+$/.test(s)));
  return { button: new RegExp(`${BUTTON_SELECTOR.source}|${classes(sized).source}`), selfSizing: classes(list.split(",").map((c) => c.trim())) };
}

function buttonGeometry(css: string, rules: ButtonRules): string[] {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const [, selectors, block] of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const owned = selectors!.split(",").filter((s) => rules.button.test(s) && !rules.selfSizing.test(s));
    if (owned.length === 0) continue;
    for (const d of declarations(`${block};`)) if (BUTTON_GEOMETRY.test(d.prop)) found.push(`${owned[0]!.trim()} { ${d.prop} }`);
  }
  return found;
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

describe("buttonGeometry", () => {
  const rules = buttonRules("#ui button:where(:not(.inv-item, .perk)) { height: 1px } #ui :is(.btn-s, .log-expand) { height: 1px }");

  it("flags a button rule that sets height, padding or type size", () => {
    expect(buttonGeometry(".a button { padding: 0; }", rules)).toEqual([".a button { padding }"]);
    expect(buttonGeometry(".close { font-size: 1em; } @media (x) { #ui .b button { height: 1px } }", rules)).toEqual([".close { font-size }", "#ui .b button { height }"]);
  });

  it("flags a rule on a class that components.css sizes", () => {
    expect(buttonGeometry("#ui .log-expand { padding: 0 }", rules)).toEqual(["#ui .log-expand { padding }"]);
  });

  it("passes width, placement, tiles and non-button rules", () => {
    expect(buttonGeometry(".a button { width: 100%; margin-left: auto; } button.inv-item { padding: 2px; } .a { padding: 1px; }", rules)).toEqual([]);
    expect(buttonGeometry(".perk-choice button.perk { padding: 2px; } .log-expanded { padding: 0 }", rules)).toEqual([]);
  });
});

const styleDir = "src/ui/styles/";
const drawings = new Set(["drawings.css"]);
const buttonOwners = new Set(["components.css", "base.css", "drawings.css"]);
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

  it("size a text button only in components.css", () => {
    const rules = buttonRules(read(styleDir + "components.css"));
    const found: string[] = [];
    for (const f of readdirSync(new URL(styleDir, root)).filter((f) => f.endsWith(".css") && !buttonOwners.has(f)))
      for (const v of buttonGeometry(read(styleDir + f), rules)) found.push(`${f}: ${v}`);
    for (const v of buttonGeometry(read("src/ui/truck-condition.css"), rules)) found.push(`truck-condition.css: ${v}`);
    expect(found).toEqual([]);
  });
});

const MONEY_BUILT_BY_HAND = /\}\s?M\b|["'`] M["'`]/;

export function handBuiltMoney(source: string): string[] {
  return source.split("\n").flatMap((line, i) => (MONEY_BUILT_BY_HAND.test(line) ? [`${i + 1}: ${line.trim()}`] : []));
}

describe("handBuiltMoney", () => {
  it("flags a money string built with an M suffix", () => {
    expect(handBuiltMoney("a(`${price} M`);\nb(price + ' M');")).toEqual(["1: a(`${price} M`);", "2: b(price + ' M');"]);
  });

  it("passes the shared formatters and words that contain an M", () => {
    expect(handBuiltMoney("a(moneyText(price));\nb('MG fires');\nc(`${n} Meters`);")).toEqual([]);
  });
});

describe("money text", () => {
  it("is built only in units.ts", () => {
    const offenders: string[] = [];
    const files = readdirSync(new URL("src/ui/", root)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "units.ts");
    for (const f of files) for (const hit of handBuiltMoney(read(`src/ui/${f}`))) offenders.push(`src/ui/${f}:${hit}`);
    expect(offenders).toEqual([]);
  });
});
