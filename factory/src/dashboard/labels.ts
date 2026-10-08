import type { CardStep } from '../card-events';
import type { Activity } from '../observability';
import type { WaitReason } from '../tick';
import type { Column, JobStage, Queue } from '../types';
import type { DeliveryStage, Gate } from './delivery';

// The page's words for the factory's names. Each record is keyed by the factory's own type, so a new column, stage, queue,
// activity, wait reason or delivery stage does not compile until it has a label here. The snapshot carries them to the page.
// Only type imports, so the browser test can load this file with Node's type stripping.
const columns: Record<Column, string> = {
  Triage: 'Triage', Design: 'Design', Implementation: 'Implement', Testing: 'Test', Approval: 'Approval', Hardening: 'Hardening', Merging: 'Merging', Done: 'Done',
};
const stages: Record<JobStage, string> = {
  triage: 'Triage', design: 'Design', implement: 'Implement', verify: 'Verify', harden: 'Harden', checks: 'Test', approve: 'Approval', merge: 'Merge',
  playtest: 'Playtest', adhoc: 'Private task', change: 'Factory change', candidate: 'Candidate', release: 'Release', ship: 'Ship', remove: 'Removal',
  incident: 'Incident', dev: 'Dev build', waste: 'Review',
};
const queues: Record<Queue, string> = { branch: 'Branch', triage: 'Triage', design: 'Design', implement: 'Implement', verify: 'Verify', test: 'Test' };
const activities: Record<Activity, string> = {
  starting: 'Starting', model: 'Waiting for model', reading: 'Reading code', editing: 'Editing code', command: 'Running command', tests: 'Running tests',
  typecheck: 'Typechecking', playtest: 'Running playtest', build: 'Building', publish: 'Publishing', install: 'Installing dependencies', git: 'Git operation',
  lock: 'Waiting for repository lock', review: 'Reviewing', design: 'Designing', investigate: 'Investigating', waiting: 'Waiting', finished: 'Finished',
};
const reasons: Record<WaitReason, string> = {
  'queue-full': 'Queue occupied', 'issue-running': 'Already running', 'daily-cap': 'Daily job limit', 'card-budget': 'Card job limit',
  'needs-info': 'Needs author reply', failed: 'Failed job needs attention', approval: 'Needs committee approval', held: 'Held until resumed',
};
const dwell: Record<DeliveryStage, string> = {
  triage: 'Triage', design: 'Design', implementation: 'Implementation', preview: 'Testing', approval: 'Committee approval', harden: 'Hardening', merge: 'Merge queue',
};
// Keyed by every loop step. labels.test.ts checks the keys against LOOP_STEPS, which delivery.ts computes.
const loops: Partial<Record<CardStep, string>> = {
  questions: 'Design asks the author', rebuild: 'Visual review: rebuild', 'plan-wrong': 'Testing finds the plan wrong', 'review-failed': 'Code review fails twice',
  patch: 'Committee patch', redesign: 'Committee redesign', 'patch-replan': 'Patch needs a new plan', conflict: 'Merge conflict', removed: 'Removed from release',
  unbundled: 'Bundle lead dropped',
};
const gates: Record<Gate, string> = { triage: 'Triage wont-do', design: 'Design wont-do', committee: 'Committee Deny' };

export const LABELS = { columns, stages, queues, activities, reasons, dwell, loops, gates };
export type Labels = typeof LABELS;
