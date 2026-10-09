// The stuck label and the stuck sweep. Every tick the sweep records why each open stuck card waits, repairs only mechanical causes
// with the sanctioned retry and repair-clone, and releases a timed-out merge batch half at a time. docs/operations.md#stuck-sweep has the rules.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeError } from './fail';
import { inMergeBatch } from './position';
import type { RepairOrder } from './repair-clone';
import { baseBranchFor } from './stages/common';
import { readState, updateState } from './state';
import { OPEN_MARKS, RELEASE_LABEL, STUCK_LABEL, WORK_DIR, type Card, type Column, type Ctx, type Failure, type FactoryState, type StuckCause, type StuckKind, type StuckRecord } from './types';

export type Repair = (ctx: Ctx, order: RepairOrder) => Promise<string[]>;
export type SweepInput = { state: FactoryState; cards: Card[]; now: Date; diskOk: boolean; marks: (issue: number) => string[] };
type Records = Record<string, StuckRecord>;

const CLONE_COLUMNS: Column[] = ['Design', 'Implementation', 'Testing', 'Hardening'];
const BATCH_DOWN = /^(timed out after \d+ minutes|job process died without finishing)/;
const GITHUB_DOWN = /\bgh\b.*(timed out after|rate limit|HTTP 5\d\d|connection (reset|refused)|could not resolve host|unexpected EOF)/i;
const DISK_FULL = /no space left on device|ENOSPC/i;
const DECISION = /budget|committee decision/i;
const UNRECORDED = 'no failure names this card';

export async function clearStuck(ctx: Ctx, issue: number): Promise<void> {
  await ctx.github.removeLabel(issue, STUCK_LABEL);
  updateState(ctx.statePath, (state: FactoryState) => ({ ...state, failures: state.failures.filter((row) => row.issue !== issue) }));
}

export function isOpenStuck(card: Card): boolean {
  return card.column !== 'Done' && card.labels.includes(STUCK_LABEL);
}

export function classifyStuck(input: SweepInput): Records {
  const records = input.cards.filter(isOpenStuck).map((card) => [String(card.issue), recordOf(input, card)] as const);
  return Object.fromEntries(records);
}

function recordOf(input: SweepInput, card: Card): StuckRecord {
  const prev = input.state.stuck[String(card.issue)];
  const cause = causeOf(input, card.issue, prev);
  const same = prev !== undefined && prev.incident === cause.incident;
  const tries = prev !== undefined && prev.column === card.column ? prev.tries : 0;
  const record = { ...cause, column: card.column, tries, released: same ? prev.released : null, refused: same ? prev.refused : null };
  return { ...record, kind: kindOf(input, card, record) };
}

function causeOf(input: SweepInput, issue: number, prev: StuckRecord | undefined): StuckCause {
  const failure = newestFailure(input.state, issue);
  if (failure !== null) return fromFailure(issue, failure);
  if (prev !== undefined) return { incident: prev.incident, stage: prev.stage, cause: prev.cause, log: prev.log, batch: prev.batch, since: prev.since, decision: prev.decision };
  const now = input.now.toISOString();
  return { incident: `${issue}:unrecorded:${now}`, stage: null, cause: UNRECORDED, log: null, batch: 0, since: now, decision: false };
}

function newestFailure(state: FactoryState, issue: number): Failure | null {
  const own = state.failures.filter((failure) => failure.issue === issue || (failure.stage === 'merge' && (failure.batch ?? []).includes(issue)));
  return own.reduce<Failure | null>((newest, failure) => (newest === null || failure.at >= newest.at ? failure : newest), null);
}

function fromFailure(issue: number, failure: Failure): StuckCause {
  const decision = failure.decision ?? DECISION.test(failure.error);
  return { incident: `${issue}:${failure.stage}:${failure.at}`, stage: failure.stage, cause: failure.error, log: failure.log, batch: failure.batch?.length ?? 0, since: failure.at, decision };
}

type Unkinded = Omit<StuckRecord, 'kind'>;

function kindOf(input: SweepInput, card: Card, record: Unkinded): StuckKind {
  if (input.state.jobs.some((job) => job.issue === card.issue || inMergeBatch(job, card))) return 'running';
  if (String(card.issue) in input.state.held) return 'held';
  if (record.stage === null) return 'unrecorded';
  return needsPerson(card, record) ? 'blocked' : mechanicalKind(input, card, record);
}

function needsPerson(card: Card, record: Unkinded): boolean {
  return record.refused !== null || record.decision || card.labels.includes(RELEASE_LABEL);
}

function mechanicalKind(input: SweepInput, card: Card, record: Unkinded): StuckKind {
  if (isBatchDown(card, record)) return 'merge-batch';
  if (record.tries > 0) return 'blocked';
  if (hasOpenMerge(input, card)) return 'clone-merge';
  return machineGone(input, record) ? 'machine' : 'blocked';
}

function isBatchDown(card: Card, record: Unkinded): boolean {
  return card.column === 'Merging' && record.stage === 'merge' && record.batch > 1 && BATCH_DOWN.test(record.cause);
}

function hasOpenMerge(input: SweepInput, card: Card): boolean {
  return CLONE_COLUMNS.includes(card.column) && input.marks(card.issue).length > 0;
}

function machineGone(input: SweepInput, record: Unkinded): boolean {
  return GITHUB_DOWN.test(record.cause) || (input.diskOk && DISK_FULL.test(record.cause));
}

export function openMarks(home: string, issue: number): string[] {
  const git = join(WORK_DIR(home, issue), '.git');
  return OPEN_MARKS.filter((mark) => existsSync(join(git, mark)));
}

export async function sweepStuck(ctx: Ctx, cards: Card[], diskOk: boolean, repair: Repair): Promise<Card[]> {
  try {
    const released = await sweepOnce(ctx, cards, diskOk, repair);
    updateState(ctx.statePath, (state) => ({ ...state, sweepError: null }));
    return cards.map((card) => (released.includes(card.issue) ? { ...card, labels: card.labels.filter((label) => label !== STUCK_LABEL) } : card));
  } catch (error) {
    const message = errorText(error);
    ctx.log('tick', null, `stuck sweep failed, every stuck card stays as it is: ${message}`);
    updateState(ctx.statePath, (state) => ({ ...state, sweepError: summarizeError(message) }));
    return cards;
  }
}

async function sweepOnce(ctx: Ctx, cards: Card[], diskOk: boolean, repair: Repair): Promise<number[]> {
  const state = readState(ctx.statePath);
  const records = classifyStuck({ state, cards, now: ctx.now(), diskOk, marks: (issue) => openMarks(ctx.cfg.home, issue) });
  writeRecords(ctx, state.stuck, { ...awaitingOutcome(state.stuck, cards, records), ...records });
  const merged = await releaseMergeGroups(ctx, state, cards, records);
  const repaired = diskOk ? await actOnFirst(ctx, records, 'clone-merge', (issue, record) => repairOne(ctx, issue, record, repair)) : [];
  const retried = await actOnFirst(ctx, records, 'machine', (issue) => clearStuck(ctx, issue));
  return [...merged, ...repaired, ...retried];
}

function awaitingOutcome(prev: Records, cards: Card[], current: Records): Records {
  const column = new Map(cards.map((card) => [String(card.issue), card.column]));
  return Object.fromEntries(Object.entries(prev).filter(([issue, record]) => !(issue in current) && record.released !== null && column.get(issue) === record.column));
}

function writeRecords(ctx: Ctx, prev: Records, next: Records): void {
  updateState(ctx.statePath, (state) => ({ ...state, stuck: next }));
  for (const [issue, record] of Object.entries(next)) {
    const old = prev[issue];
    if (old?.incident === record.incident && old.kind === record.kind) continue;
    ctx.log('tick', Number(issue), `stuck sweep: ${record.kind}, incident ${record.incident}: ${record.cause.split('\n')[0]}`);
  }
  for (const issue of Object.keys(prev).filter((key) => !(key in next))) ctx.log('tick', Number(issue), 'stuck sweep: no longer stuck, record dropped');
}

async function releaseMergeGroups(ctx: Ctx, state: FactoryState, cards: Card[], records: Records): Promise<number[]> {
  if (state.jobs.some((job) => job.stage === 'merge')) return [];
  const waiting = cards.filter((card) => records[String(card.issue)]?.kind === 'merge-batch');
  const bases = basesOf(ctx, waiting);
  const released: number[] = [];
  for (const [base, group] of bases) {
    if (cards.some((card) => readyToMerge(state, card) && baseOf(ctx, card) === base)) continue;
    released.push(...(await releaseHalf(ctx, group.map((card) => [card.issue, records[String(card.issue)]!] as const))));
  }
  return released;
}

function readyToMerge(state: FactoryState, card: Card): boolean {
  return card.column === 'Merging' && !card.labels.includes(STUCK_LABEL) && !(String(card.issue) in state.held);
}

function baseOf(ctx: Ctx, card: Card): string | null {
  try {
    return baseBranchFor(ctx, card.labels);
  } catch {
    return null;
  }
}

function basesOf(ctx: Ctx, cards: Card[]): Map<string, Card[]> {
  const bases = new Map<string, Card[]>();
  for (const card of cards) {
    const base = baseOf(ctx, card);
    if (base === null) refuse(ctx, card.issue, 'its base branch is unknown, since no release is open');
    else bases.set(base, [...(bases.get(base) ?? []), card]);
  }
  return bases;
}

async function releaseHalf(ctx: Ctx, group: (readonly [number, StuckRecord])[]): Promise<number[]> {
  const sorted = [...group].sort(([a, ra], [b, rb]) => ra.since.localeCompare(rb.since) || a - b);
  const [, first] = sorted[0]!;
  const half = sorted.filter(([, record]) => record.since === first.since && record.stage === first.stage).slice(0, Math.ceil(first.batch / 2));
  const released: number[] = [];
  for (const [issue] of half) if (await releaseOne(ctx, issue, first.batch)) released.push(issue);
  return released;
}

async function releaseOne(ctx: Ctx, issue: number, batch: number): Promise<boolean> {
  markTry(ctx, issue);
  try {
    await clearStuck(ctx, issue);
    ctx.log('tick', issue, `stuck sweep: released into the next merge batch, half of a failed batch of ${batch}`);
    return true;
  } catch (error) {
    ctx.log('tick', issue, `stuck sweep: could not release the card, it stays stuck and the next tick tries again: ${errorText(error)}`);
    return false;
  }
}

async function actOnFirst(ctx: Ctx, records: Records, kind: StuckKind, action: (issue: number, record: StuckRecord) => Promise<unknown>): Promise<number[]> {
  const found = Object.entries(records).find(([, record]) => record.kind === kind);
  if (found === undefined) return [];
  const issue = Number(found[0]);
  markTry(ctx, issue);
  try {
    await action(issue, found[1]);
    ctx.log('tick', issue, `stuck sweep: ${kind} handled, the stuck label is gone`);
    return [issue];
  } catch (error) {
    refuse(ctx, issue, errorText(error));
    return [];
  }
}

async function repairOne(ctx: Ctx, issue: number, record: StuckRecord, repair: Repair): Promise<void> {
  const lines = await repair(ctx, { issue, by: 'factory', reason: `stuck sweep, incident ${record.incident}`, backupMerge: true, refuseUnpushed: true });
  for (const line of lines) ctx.log('tick', issue, `stuck sweep: ${line}`);
}

function markTry(ctx: Ctx, issue: number): void {
  const at = ctx.now().toISOString();
  updateRecord(ctx, issue, (record) => ({ ...record, tries: record.tries + 1, released: at }));
}

function refuse(ctx: Ctx, issue: number, reason: string): void {
  ctx.log('tick', issue, `stuck sweep: left for Hermes: ${reason}`);
  updateRecord(ctx, issue, (record) => ({ ...record, kind: 'blocked', released: null, refused: summarizeError(reason) }));
}

function updateRecord(ctx: Ctx, issue: number, change: (record: StuckRecord) => StuckRecord): void {
  updateState(ctx.statePath, (state) => {
    const record = state.stuck[String(issue)];
    return record === undefined ? state : { ...state, stuck: { ...state.stuck, [issue]: change(record) } };
  });
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
