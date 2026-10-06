import { describe, expect, it } from "vitest";
import { balanceNumber, balanceText, moneyNumber, moneyText } from "./money";

describe("currency text", () => {
  it("reads one M and many M's with grouping", () => {
    expect(moneyText(1)).toBe("1 M");
    expect(moneyText(0)).toBe("0 M's");
    expect(moneyText(1200)).toBe("1,200 M's");
    expect(moneyText(1234567)).toBe("1,234,567 M's");
    expect(moneyNumber(1200)).toBe("1,200");
  });

  it("fails loud on a negative or non-finite amount", () => {
    expect(() => moneyText(-5)).toThrow();
    expect(() => moneyText(NaN)).toThrow();
    expect(() => moneyNumber(Infinity)).toThrow();
  });

  it("reads a negative balance as debt", () => {
    expect(balanceText(-1200)).toBe("Debt 1,200 M's");
    expect(balanceText(-1)).toBe("Debt 1 M");
    expect(balanceText(30)).toBe("30 M's");
    expect(balanceNumber(-1200)).toBe("Debt 1,200");
    expect(balanceNumber(5)).toBe("5");
  });
});
