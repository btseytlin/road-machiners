import { readLedger } from './ledger';
import { isAnswered, isFactoryQuestion } from './questions';
import { readState, updateState } from './state';
import { FACTORY_MARK, NEEDS_INFO_LABEL, RELEASE_LABEL, STUCK_LABEL, type Card, type Ctx, type DependencyHold, type FactoryState, type IssueComment } from './types';

// A dependency hold keeps one issue's card, branch and design where they are while the issues its text says must land first have not merged into dev.
// It lives in the state file, so it needs no label, no pause and no failure record. The tick rechecks dev and lifts it by itself.

export const HOLD_HEADING = '## Dependency hold';
const HOLD_COLUMNS: Card['column'][] = ['Triage', 'Design', 'Implementation'];

// A sentence names a prerequisite only with one of these phrases. "See #12" or "similar to #12" never does.
const ORDER_PHRASES = [
  /\bwait(?:s|ed|ing)?\s+(?:until|for|on|till)\b/,
  /\bblocked\s+(?:by|on)\b/,
  /\bdepend(?:s|ing)?\s+on\b/,
  /\bprerequisites?\b/,
  /\bonly\s+after\b/,
  /\b(?:do|does)(?:n['’]t|\s+not)\s+(?:start|begin|build|design|implement)\b.*\b(?:until|before)\b/,
  /\b(?:after|once|when)\b.*\b(?:merges|merge|lands|land|is\s+merged|are\s+merged|has\s+merged|have\s+merged|be\s+merged)\b/,
  /\b(?:must|should|needs?\s+to|has\s+to)\s+(?:be\s+)?(?:merge[sd]?|land(?:ed)?)\s+first\b/,
  /\brequires?\b.*\b(?:merges|merge|lands|land|is\s+merged|are\s+merged|be\s+merged)\b/,
];
const NEGATION = /\b(?:not|never|no\s+need\s+to|independent\s+of)\b.*\b(?:wait|depend|blocked)|\bn['’]t\s+(?:need\s+to\s+)?(?:wait|depend)/;

// The issues the text says must land first, lowest first. Only a sentence with an ordering phrase counts, and the issue itself never does.
export function explicitPrerequisites(text: string, self: number): number[] {
  const found = new Set<number>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const lower = sentence.toLowerCase();
    if (!ORDER_PHRASES.some((phrase) => phrase.test(lower)) || NEGATION.test(lower)) continue;
    for (const match of sentence.matchAll(/#(\d+)\b/g)) found.add(Number(match[1]));
  }
  found.delete(self);
  return [...found].sort((a, b) => a - b);
}

export function activeHold(state: FactoryState, issue: number): DependencyHold | null {
  const hold = state.holds[String(issue)];
  return hold !== undefined && hold.released === null ? hold : null;
}

// A card waits while its hold stands, in the columns whose stages the hold stops.
export function isHeld(state: FactoryState, card: Card): boolean {
  return HOLD_COLUMNS.includes(card.column) && activeHold(state, card.issue) !== null;
}

// A bundled issue rides on its lead's branch, so the lead's merge is the one that counts.
function mergedAs(state: FactoryState, issue: number): number {
  const lead = Object.entries(state.bundles).find(([, bundled]) => bundled.includes(issue));
  return lead === undefined ? issue : Number(lead[0]);
}

async function landed(ctx: Ctx, issue: number): Promise<boolean> {
  try {
    return await ctx.repo.issueMerged(mergedAs(readState(ctx.statePath), issue), 'dev');
  } catch (error) {
    ctx.log('tick', issue, `could not read whether #${issue} merged into dev, so it counts as not merged: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function unmet(ctx: Ctx, prerequisites: number[]): Promise<number[]> {
  const waiting: number[] = [];
  for (const issue of prerequisites) if (!(await landed(ctx, issue))) waiting.push(issue);
  return waiting;
}

const list = (issues: number[]): string => issues.map((issue) => `#${issue}`).join(' and ');

// Records a hold on the issue, says so on it once and returns the cards as they stand. The card, its branch and its design stay as they are.
export async function applyHold(ctx: Ctx, issue: number, prerequisites: number[]): Promise<void> {
  updateState(ctx.statePath, (state) => ({ ...state, holds: { ...state.holds, [String(issue)]: { prerequisites, since: ctx.now().toISOString(), released: null } }, dependencyScanned: [...new Set([...state.dependencyScanned, issue])] }));
  ctx.log('tick', issue, `dependency hold on ${list(prerequisites)}`);
  await ctx.github.comment(issue, `${HOLD_HEADING}\n\nThis issue waits for ${list(prerequisites)} to merge into dev. The card, its branch and its design stay as they are. The factory checks dev on every tick and starts the next stage by itself once all of them have merged. Nobody needs to answer anything here.`);
}

export function dropHold(ctx: Ctx, issue: number): boolean {
  const had = String(issue) in readState(ctx.statePath).holds;
  updateState(ctx.statePath, (state) => ({ ...state, holds: Object.fromEntries(Object.entries(state.holds).filter(([key]) => key !== String(issue))) }));
  return had;
}

async function release(ctx: Ctx, issue: number, hold: DependencyHold): Promise<void> {
  updateState(ctx.statePath, (state) => ({ ...state, holds: { ...state.holds, [String(issue)]: { ...hold, released: ctx.now().toISOString() } } }));
  ctx.log('tick', issue, `dependency hold released, ${list(hold.prerequisites)} merged into dev`);
  await ctx.github.comment(issue, `${HOLD_HEADING} released\n\n${list(hold.prerequisites)} merged into dev. The next stage of this issue starts on the next tick, with no further answer needed.`);
}

// Rechecks every standing hold against dev, and reads each new card in a hold column once for explicit prerequisites.
// An issue with no hold and an earlier read costs no GitHub call. Returns the cards as they stand after label changes.
export async function settleHolds(ctx: Ctx, cards: Card[]): Promise<Card[]> {
  for (const [key, hold] of Object.entries(readState(ctx.statePath).holds)) await releaseIfLanded(ctx, Number(key), hold);
  const scanned = new Set(readState(ctx.statePath).dependencyScanned);
  const settled: Card[] = [];
  for (const card of cards) settled.push(needsScan(card, scanned) ? await scan(ctx, card) : card);
  return settled;
}

async function releaseIfLanded(ctx: Ctx, issue: number, hold: DependencyHold): Promise<void> {
  if (hold.released === null && (await unmet(ctx, hold.prerequisites)).length === 0) await release(ctx, issue, hold);
}

function needsScan(card: Card, scanned: Set<number>): boolean {
  return HOLD_COLUMNS.includes(card.column) && !card.labels.includes(RELEASE_LABEL) && !scanned.has(card.issue);
}

async function scan(ctx: Ctx, card: Card): Promise<Card> {
  try {
    const { body } = await ctx.github.issue(card.issue);
    const prerequisites = explicitPrerequisites(body, card.issue);
    if (prerequisites.length === 0 || (await unmet(ctx, prerequisites)).length === 0) {
      updateState(ctx.statePath, (state) => ({ ...state, dependencyScanned: [...state.dependencyScanned, card.issue] }));
      return card;
    }
    await applyHold(ctx, card.issue, prerequisites);
    return await migrate(ctx, card);
  } catch (error) {
    ctx.log('tick', card.issue, `could not read the dependencies, the next tick tries again: ${error instanceof Error ? error.message : String(error)}`);
    return card;
  }
}

// A failed job leaves a record in the state file or in the ledger. A stuck label with neither is a hand-made stop, such as Hermes holding the issue for its dependencies.
function hasFailureRecord(ctx: Ctx, issue: number): boolean {
  if (readState(ctx.statePath).failures.some((failure) => failure.issue === issue)) return true;
  return readLedger(ctx.cfg.home, new Date(0)).some((line) => line.kind === 'job' && line.issue === issue && line.outcome !== 'done');
}

// Moves an issue that waited by hand onto the hold. Only the stuck label of an issue with no failed job goes, and a failed job's label and record stay.
// A card that Design sent back to Triage with questions the author answered goes back to Design, since the questions only asked about the wait.
async function migrate(ctx: Ctx, card: Card): Promise<Card> {
  let labels = card.labels;
  if (labels.includes(STUCK_LABEL) && !hasFailureRecord(ctx, card.issue)) {
    await ctx.github.removeLabel(card.issue, STUCK_LABEL);
    ctx.log('tick', card.issue, `removed ${STUCK_LABEL}, the dependency hold stops the issue and no failed job is recorded`);
    labels = labels.filter((label) => label !== STUCK_LABEL);
  }
  if (card.column !== 'Triage' || labels.includes(NEEDS_INFO_LABEL)) return { ...card, labels };
  if (!askedByDesign(await ctx.github.comments(card.issue))) return { ...card, labels };
  await ctx.github.move(card.issue, 'Design');
  ctx.log('tick', card.issue, 'moved back to Design, its answered questions came from the design stage');
  return { ...card, labels, column: 'Design' };
}

// Triage passed, and later questions were asked and answered. Only Design asks questions after Triage passed.
function askedByDesign(comments: IssueComment[]): boolean {
  const passed = comments.map((comment) => comment.body.includes(FACTORY_MARK) && comment.body.startsWith('Triage passed')).lastIndexOf(true);
  const asked = comments.map(isFactoryQuestion).lastIndexOf(true);
  return passed >= 0 && asked > passed && isAnswered(comments);
}

// What the stage agent reads: the prerequisites that merged, so it never asks the author whether to wait for them.
export function dependencyNote(state: FactoryState, issue: number): string | null {
  const hold = state.holds[String(issue)];
  if (hold === undefined || hold.released === null) return null;
  return `The factory held this issue until ${list(hold.prerequisites)} merged into dev. They have merged. Never ask the author whether to wait for them.\n`;
}
