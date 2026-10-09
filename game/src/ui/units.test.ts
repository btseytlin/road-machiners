import { describe, expect, it } from 'vitest';
import { moneyAmount, moneyDelta, moneyText, turnsText } from './units';

describe('money display', () => {
  it('reads cents as whole M', () => {
    expect(moneyAmount(0)).toBe('0');
    expect(moneyAmount(100)).toBe('1');
    expect(moneyAmount(33300)).toBe('333');
    expect(moneyAmount(166700)).toBe('1,667');
  });

  it('rounds any part of an M up, so a price never reads below what it costs', () => {
    expect(moneyAmount(1)).toBe('1');
    expect(moneyAmount(5)).toBe('1');
    expect(moneyAmount(99)).toBe('1');
    expect(moneyAmount(101)).toBe('2');
    expect(moneyAmount(167)).toBe('2');
    expect(moneyAmount(166667)).toBe('1,667');
  });

  it('rounds a debt away from zero, so a debt never reads smaller than it is', () => {
    expect(moneyAmount(-100)).toBe('−1');
    expect(moneyAmount(-101)).toBe('−2');
    expect(moneyAmount(-1250)).toBe('−13');
  });

  it('ignores float noise below half a cent', () => {
    expect(moneyAmount(100.0000001)).toBe('1');
    expect(moneyAmount(333.4)).toBe('4');
    expect(moneyAmount(0.4)).toBe('0');
    expect(moneyAmount(-0.4)).toBe('0');
  });

  it('names the unit in running text', () => {
    expect(moneyText(167)).toBe('2 M');
    expect(moneyText(100)).toBe('1 M');
    expect(moneyText(-1250)).toBe('−13 M');
  });

  it('signs a delta with a plus or a real minus', () => {
    expect(moneyDelta(1500)).toBe('+15 M');
    expect(moneyDelta(-1500)).toBe('−15 M');
    expect(moneyDelta(0)).toBe('0 M');
    expect(moneyDelta(-0.4)).toBe('0 M');
  });

  it('counts turns with a plural', () => {
    expect(turnsText(1)).toBe('1 turn');
    expect(turnsText(0)).toBe('0 turns');
    expect(turnsText(3)).toBe('3 turns');
  });
});
