import { describe, expect, it } from 'vitest';
import { BudgetError, runCost, untilPasses } from './checkpoint';

const run = (cost: number) => `${JSON.stringify({ type: 'result', total_cost_usd: cost, duration_ms: 1000 })}\n`;

describe('untilPasses', () => {
  it('ends on the first pass with no fix', async () => {
    const fixes: string[] = [];
    await untilPasses(10, 1, async () => null, async (failure) => { fixes.push(failure); return run(1); });
    expect(fixes).toEqual([]);
  });

  it('hands each failure to the fix until the check passes', async () => {
    const results = ['broke', 'broke again', null];
    const fixes: string[] = [];
    await untilPasses(10, 1, async () => results.shift() ?? null, async (failure) => { fixes.push(failure); return run(1); });
    expect(fixes).toEqual(['broke', 'broke again']);
  });

  it('throws a BudgetError with the last failure once the runs cost the budget', async () => {
    const fixes: string[] = [];
    const loop = untilPasses(5, 2, async () => 'still broken', async (failure) => { fixes.push(failure); return run(2); });
    await expect(loop).rejects.toThrow(BudgetError);
    await expect(untilPasses(5, 2, async () => 'still broken', async () => run(2))).rejects.toThrow(/\$6\.00 of its \$5 budget[\s\S]*still broken/);
    expect(fixes).toHaveLength(2);
  });
});

describe('runCost', () => {
  it('reads the cost of the result event', () => {
    expect(runCost(run(1.25))).toBe(1.25);
  });
});
