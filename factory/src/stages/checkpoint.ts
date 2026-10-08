import { usageFromOutput } from '../ledger';

// A stage's agents spent its budget and its checkpoint still fails. Only this ends a stage for Hermes.
export class BudgetError extends Error {}

// What one agent run cost, from the result event of its stream.
export function runCost(stream: string): number {
  return usageFromOutput(stream, '').costUsd;
}

// A stage's checkpoint. `check` returns null on a pass or the failure text. `fix` hands the failure to the session that did the work
// and returns its stream. The loop ends on a pass, or throws once the stage's runs cost the budget. `spent` is what the stage's first run cost.
export async function untilPasses(budgetUsd: number, spent: number, check: () => Promise<string | null>, fix: (failure: string) => Promise<string>): Promise<void> {
  let total = spent;
  for (;;) {
    const failure = await check();
    if (failure === null) return;
    if (total >= budgetUsd) throw new BudgetError(`The stage spent $${total.toFixed(2)} of its $${budgetUsd} budget, and its checkpoint still fails.\n${failure}`);
    total += runCost(await fix(failure));
  }
}
