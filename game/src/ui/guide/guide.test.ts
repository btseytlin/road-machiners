import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOKENS } from "../tokens";
import { PIECES } from "./pieces";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const components = read("../styles/components.css");
const guide = read("../../../docs/ui.md");

const componentClasses = [...new Set([...components.matchAll(/(?:^|\n)(?:#ui )?\.([a-z][a-z-]*)/g)].map((m) => m[1]!))];

describe("the UI guide", () => {
  it("shows every shared class of components.css in ui.html", () => {
    const shown = PIECES.map((p) => p.name).join(" ");
    for (const cls of componentClasses) expect(shown, `.${cls} is missing from PIECES`).toContain(`.${cls}`);
  });

  it("names every shared piece in docs/ui.md", () => {
    for (const piece of PIECES) expect(guide, `${piece.name} is missing from docs/ui.md`).toContain(`\`${piece.name.split(".meter.")[0]!}`);
  });

  it("names the first token of each scale in docs/ui.md", () => {
    for (const name of ["--space-1", "--text-caption", "--surface-sunk", "--line-faint", "--panel-s", "--z-hud", "--icon-xs"]) {
      expect(TOKENS.has(name)).toBe(true);
      expect(guide).toContain(name);
    }
  });
});
