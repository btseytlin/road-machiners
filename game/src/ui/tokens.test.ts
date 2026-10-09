import { describe, expect, it } from "vitest";
import { parseTokens, tokenColor } from "./tokens";

describe("parseTokens", () => {
  it("reads the custom properties of the first :root block only", () => {
    const css = ":root {\n  --a: #102030;\n  /* note */\n  --b: 4px;\n}\n@media (max-width: 9px) {\n  :root {\n    --b: 2px;\n  }\n}";
    expect(parseTokens(css)).toEqual(new Map([["--a", "#102030"], ["--b", "4px"]]));
  });

  it("throws on a name written twice", () => {
    expect(() => parseTokens(":root {\n  --a: 1px;\n  --a: 2px;\n}")).toThrow(/--a/);
  });
});

describe("tokenColor", () => {
  it("gives a six digit hex token as a number", () => {
    expect(tokenColor("--path-plan")).toBe(0xf0e0b8);
  });

  it("throws on an unknown token", () => {
    expect(() => tokenColor("--no-such-token")).toThrow(/--no-such-token/);
  });

  it("throws on a token that is not an opaque hex color", () => {
    expect(() => tokenColor("--space-1")).toThrow(/--space-1/);
    expect(() => tokenColor("--scrim")).toThrow(/--scrim/);
  });
});
