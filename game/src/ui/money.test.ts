import { describe, expect, it } from "vitest";
import { balanceNumber, balanceText, moneyNumber, moneyText } from "./money";

describe("currency text", () => {
  it("reads one M and many M's with grouping, from cents", () => {
    expect(moneyText(100)).toBe("1 M");
    expect(moneyText(0)).toBe("0 M's");
    expect(moneyText(120000)).toBe("1,200 M's");
    expect(moneyText(123456700)).toBe("1,234,567 M's");
    expect(moneyNumber(120000)).toBe("1,200");
  });

  it("fails loud on a non-finite amount", () => {
    expect(() => moneyNumber(NaN)).toThrow();
    expect(() => moneyNumber(Infinity)).toThrow();
  });

  it("reads a negative balance as debt", () => {
    expect(balanceText(-120000)).toBe("Debt 1,200 M's");
    expect(balanceText(-100)).toBe("Debt 1 M");
    expect(balanceText(3000)).toBe("30 M's");
    expect(balanceNumber(-120000)).toBe("Debt 1,200");
    expect(balanceNumber(500)).toBe("5");
  });
});
