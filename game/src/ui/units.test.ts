import { describe, expect, it } from 'vitest';
import { moneyAmount, moneyText } from './units';

describe('money display', () => {
  it('reads cents as M with no decimals for a whole M and two otherwise', () => {
    expect(moneyAmount(0)).toBe('0');
    expect(moneyAmount(5)).toBe('0.05');
    expect(moneyAmount(100)).toBe('1');
    expect(moneyAmount(167)).toBe('1.67');
    expect(moneyAmount(33300)).toBe('333');
    expect(moneyAmount(166667)).toBe('1,666.67');
    expect(moneyAmount(-1250)).toBe('-12.50');
  });

  it('rounds a fractional amount to the nearest cent', () => {
    expect(moneyAmount(333.4)).toBe('3.33');
    expect(moneyAmount(-0.4)).toBe('0');
  });

  it('names the unit in running text', () => {
    expect(moneyText(167)).toBe('1.67 M');
    expect(moneyText(100)).toBe('1 M');
  });
});
