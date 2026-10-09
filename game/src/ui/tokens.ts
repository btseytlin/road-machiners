// Reads the design tokens of tokens.css for code that cannot use CSS, like Three.js overlay colors.
// parseTokens() reads the first :root block only, since the media blocks after it only resize the layout.
// tokenColor() gives an opaque hex color token as a Three.js color number and throws on any other token.
import tokensCss from "./tokens.css?raw";

export function parseTokens(css: string): Map<string, string> {
  const root = css.match(/:root\s*\{([^}]*)\}/);
  if (!root) throw new Error("tokens: no :root block");
  const tokens = new Map<string, string>();
  for (const m of root[1]!.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (tokens.has(m[1]!)) throw new Error(`tokens: ${m[1]} is written twice`);
    tokens.set(m[1]!, m[2]!.trim());
  }
  return tokens;
}

export const TOKENS = parseTokens(tokensCss);

export function tokenColor(name: string): number {
  const value = TOKENS.get(name);
  if (value === undefined) throw new Error(`tokens: no ${name} in tokens.css`);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`tokens: ${name} is ${value}, not an opaque hex color`);
  return parseInt(value.slice(1), 16);
}
