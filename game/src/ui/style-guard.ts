// Finds raw style values that belong in tokens.css. style-guard.test.ts runs it over every game style.
// A CSS scope with geometry off skips spacing and sizes: drawings.css keeps the shapes of its hardware drawings.

const COLOR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i;
const PIXELS = /(?<![\w-])-?\d+(?:\.\d+)?px\b/g;
const HAIRLINE = new Set(["0px", "1px"]);
const GEOMETRY = /^(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block))?$|^(?:row-|column-)?gap$|^(?:min-|max-)?(?:width|height)$/;

export interface CssScope {
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

export function cssViolations(css: string, scope: CssScope): string[] {
  return declarations(css)
    .filter((d) => violates(d.prop, d.value, scope))
    .map((d) => `${d.prop}: ${d.value}`);
}

export function scriptViolations(source: string): string[] {
  const colors = [...source.matchAll(/(?<=['"`:\s(,])(?:#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/gi)].map((m) => m[0]);
  const fonts = [...source.matchAll(/(?<![\w$}-])\d+px\s+(?:sans-serif|serif|monospace)\b|font-size:\s*\d+px|fontSize\s*=\s*['"`]\d+px/g)].map((m) => m[0]);
  return [...colors, ...fonts];
}
