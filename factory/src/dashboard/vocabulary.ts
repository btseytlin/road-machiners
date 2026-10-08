/** Factory words the analytics queries group by, typed against the factory's own unions and loaded into DuckDB as tables.
 * A new card step, column, stage or outcome fails typecheck here until the dashboard knows where it belongs. */
import type { CardStep } from '../card-events';
import type { JobOutcome } from '../ledger';
import type { Column, JobStage } from '../types';

export type DeliveryStage = 'triage' | 'design' | 'implementation' | 'preview' | 'approval' | 'harden' | 'merge';
export type Gate = 'triage' | 'design' | 'committee';
type StepKind = 'path' | 'loop' | 'end' | 'other';
type Cell = string | number | null;
export type VocabularyTable = { name: string; columns: string[]; rows: Cell[][] };

const DELIVERY_STAGES: DeliveryStage[] = ['triage', 'design', 'implementation', 'preview', 'approval', 'harden', 'merge'];
const STEP_KINDS: Record<CardStep, StepKind> = {
  entered: 'path', accepted: 'path', planned: 'path', built: 'path', patched: 'path', posted: 'path', approved: 'path', hardened: 'path', merged: 'path',
  questions: 'loop', rebuild: 'loop', 'plan-wrong': 'loop', 'review-failed': 'loop', patch: 'loop', redesign: 'loop', 'patch-replan': 'loop', conflict: 'loop', removed: 'loop', unbundled: 'loop',
  'triage-wont-do': 'end', 'design-wont-do': 'end', bundled: 'end', denied: 'end', dropped: 'end',
  moved: 'other', 'merge-ordered': 'other', shipped: 'other', reported: 'other',
};
const GATES: Record<Gate, { pass: CardStep[]; reject: CardStep[] }> = {
  triage: { pass: ['accepted'], reject: ['triage-wont-do'] },
  design: { pass: ['planned'], reject: ['design-wont-do'] },
  committee: { pass: ['approved', 'merged'], reject: ['denied'] },
};
const COLUMN_STAGES: Record<Column, { stage: DeliveryStage | null; steps: Partial<Record<CardStep, DeliveryStage>> }> = {
  Triage: { stage: 'triage', steps: {} },
  Design: { stage: 'design', steps: {} },
  Implementation: { stage: 'implementation', steps: {} },
  Testing: { stage: 'preview', steps: { approved: 'harden', conflict: 'harden' } },
  Approval: { stage: 'approval', steps: { hardened: 'merge', 'merge-ordered': 'merge' } },
  Hardening: { stage: 'harden', steps: {} },
  Merging: { stage: 'merge', steps: {} },
  Done: { stage: null, steps: {} },
};
const RETRY_STAGES: JobStage[] = ['triage', 'design', 'implement', 'verify', 'harden', 'checks'];
const AGENT_STAGES: JobStage[] = ['triage', 'design', 'implement', 'verify', 'change', 'adhoc', 'incident', 'waste'];
const PRIVATE_STAGES: JobStage[] = ['change', 'adhoc'];
const OUTCOMES: Record<JobOutcome, { wasted: boolean; retried: boolean }> = {
  done: { wasted: false, retried: false }, held: { wasted: false, retried: false }, stopped: { wasted: true, retried: false },
  failed: { wasted: true, retried: true }, died: { wasted: true, retried: true }, timeout: { wasted: true, retried: true },
};

export const LOOP_STEPS = (Object.keys(STEP_KINDS) as CardStep[]).filter((step) => STEP_KINDS[step] === 'loop');

function columnStageRows(): Cell[][] {
  return Object.entries(COLUMN_STAGES).flatMap(([column, { stage, steps }]) => [[column, null, stage], ...Object.entries(steps).map(([step, own]) => [column, step, own])]);
}
function gateRows(): Cell[][] {
  return Object.entries(GATES).flatMap(([gate, { pass, reject }], order) => [...pass.map((step) => [gate, order, step, 'pass']), ...reject.map((step) => [gate, order, step, 'reject'])]);
}

export function vocabularyTables(): VocabularyTable[] {
  return [
    { name: 'delivery_stages', columns: ['stage', 'ord'], rows: DELIVERY_STAGES.map((stage, order) => [stage, order]) },
    { name: 'loop_steps', columns: ['step', 'ord'], rows: LOOP_STEPS.map((step, order) => [step, order]) },
    { name: 'gate_steps', columns: ['gate', 'ord', 'step', 'decision'], rows: gateRows() },
    { name: 'column_stages', columns: ['col', 'step', 'stage'], rows: columnStageRows() },
    { name: 'retry_stages', columns: ['stage', 'ord'], rows: RETRY_STAGES.map((stage, order) => [stage, order]) },
    { name: 'agent_stages', columns: ['stage'], rows: AGENT_STAGES.map((stage) => [stage]) },
    { name: 'private_stages', columns: ['stage'], rows: PRIVATE_STAGES.map((stage) => [stage]) },
    { name: 'outcomes', columns: ['outcome', 'wasted', 'retried'], rows: Object.entries(OUTCOMES).map(([outcome, { wasted, retried }]) => [outcome, Number(wasted), Number(retried)]) },
  ];
}
