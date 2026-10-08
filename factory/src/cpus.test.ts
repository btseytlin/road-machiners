import { describe, expect, it } from 'vitest';
import { cpuSets, poolOf } from './cpus';

const SHARES = { cpuLight: 0.25, cpuImplement: 0.25, cpuTest: 0.5 };

describe('poolOf', () => {
  it('gives the merge and candidate jobs the test pool, though they run in the branch queue', () => {
    expect([poolOf('merge'), poolOf('candidate'), poolOf('ship'), poolOf('approve'), poolOf('verify'), poolOf('checks')]).toEqual(['test', 'test', 'test', 'light', 'implement', 'test']);
  });
});

describe('cpuSets', () => {
  it('splits 4 CPUs into one light, one implement and two test CPUs', () => {
    expect(cpuSets(SHARES, 4)).toEqual({ light: '0', implement: '1', test: '2-3' });
  });

  it('scales the same shares to a bigger server', () => {
    expect(cpuSets(SHARES, 8)).toEqual({ light: '0-1', implement: '2-3', test: '4-7' });
    expect(cpuSets(SHARES, 16)).toEqual({ light: '0-3', implement: '4-7', test: '8-15' });
  });

  it('gives a pool whose share rounds to nothing one CPU', () => {
    expect(cpuSets({ cpuLight: 0.1, cpuImplement: 0.1, cpuTest: 0.5 }, 4)).toEqual({ light: '0', implement: '1', test: '2-3' });
  });

  it('throws when the pools need more CPUs than the server has', () => {
    expect(() => cpuSets(SHARES, 2)).toThrow('need 3 CPUs (light 1, implement 1, test 1), and the server has 2');
    expect(() => cpuSets({ cpuLight: 0.1, cpuImplement: 0.1, cpuTest: 0.8 }, 4)).toThrow('need 5 CPUs');
  });
});
