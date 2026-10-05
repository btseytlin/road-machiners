import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeHold, explicitPrerequisites, settleHolds } from './dependencies';
import { EMPTY_STATE, readState, writeState } from './state';
import { FACTORY_MARK, NEEDS_INFO_LABEL, QUESTIONS_HEADING, STUCK_LABEL, type Card, type Ctx, type FactoryState, type IssueComment } from './types';

// The words of the real regression: #253 says to wait for #242 and #243.
const BODY_253 = 'Add the convoy radio.\n\nWait until #242 and #243 merge into dev before starting this. See #100 for the old radio and #99 for the art.';

const card = (issue: number, column: Card['column'], labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column, labels });
const factory = (text: string): IssueComment => ({ login: 'bot', body: `${text}\n\n${FACTORY_MARK}` });
const author = (text: string): IssueComment => ({ login: 'anna', body: text });
const asked = factory(`${QUESTIONS_HEADING}\n\n1. Should this wait for #242?`);

type Fake = { ctx: Ctx; merged: Set<number>; reads: number[]; comments: string[]; removed: string[]; moved: string[]; state: () => FactoryState };

function fake(bodies: Record<number, string>, history: IssueComment[] = [], over: Partial<FactoryState> = {}): Fake {
  const dir = mkdtempSync(join(tmpdir(), 'deps-'));
  const statePath = join(dir, 'state.json');
  writeState(statePath, { ...structuredClone(EMPTY_STATE), ...over });
  const f: Fake = { ctx: null as unknown as Ctx, merged: new Set(), reads: [], comments: [], removed: [], moved: [], state: () => readState(statePath) };
  f.ctx = {
    cfg: { home: dir },
    statePath,
    now: () => new Date('2026-10-05T10:00:00Z'),
    log: () => undefined,
    github: {
      issue: async (n: number) => { f.reads.push(n); return { number: n, body: bodies[n] ?? '' }; },
      comments: async () => history,
      comment: async (_n: number, body: string) => { f.comments.push(body); },
      removeLabel: async (n: number, label: string) => { f.removed.push(`${n}:${label}`); },
      move: async (n: number, column: string) => { f.moved.push(`${n}:${column}`); },
    },
    repo: { issueMerged: async (issue: number, branch: string) => { if (branch !== 'dev') throw new Error(`unexpected ${branch}`); return f.merged.has(issue); } },
  } as unknown as Ctx;
  return f;
}

describe('explicitPrerequisites', () => {
  it('reads the issues a wait sentence names, without the issue itself', () => {
    expect(explicitPrerequisites(BODY_253, 253)).toEqual([242, 243]);
    expect(explicitPrerequisites('Blocked by #7.\nThis depends on #5, not #253.', 253)).toEqual([5, 7]);
    expect(explicitPrerequisites('Do not start until #8 is merged.', 9)).toEqual([8]);
    expect(explicitPrerequisites('Once #3 lands we can add it.', 9)).toEqual([3]);
  });

  it('ignores incidental mentions', () => {
    expect(explicitPrerequisites('Related to #12. See also #13, similar to #14. Fixes #15. Split out of #16 after it merged.', 20)).toEqual([]);
    expect(explicitPrerequisites('Wait times in #12 felt long.\nThe radio from #13 is the model.', 20)).toEqual([]);
  });

  it('ignores a sentence that says there is no wait', () => {
    expect(explicitPrerequisites('This does not depend on #12. No need to wait for #13.', 20)).toEqual([]);
    expect(explicitPrerequisites('This is independent of #12 and doesn\'t need to wait for #13.', 20)).toEqual([]);
  });
});

describe('settleHolds', () => {
  const cards = [card(253, 'Design')];

  it('holds an issue with an unmet explicit prerequisite, once, and says so on the issue', async () => {
    const f = fake({ 253: BODY_253 });
    await settleHolds(f.ctx, cards);
    expect(f.state().holds['253']).toMatchObject({ prerequisites: [242, 243], released: null });
    expect(activeHold(f.state(), 253)).not.toBeNull();
    expect(f.comments).toHaveLength(1);
    expect(f.comments[0]).toContain('#242 and #243');
    expect(f.comments[0]).toContain('Nobody needs to answer');
    await settleHolds(f.ctx, cards);
    expect(f.comments).toHaveLength(1);
  });

  it('stays held while one of two prerequisites has merged', async () => {
    const f = fake({ 253: BODY_253 });
    await settleHolds(f.ctx, cards);
    f.merged.add(242);
    await settleHolds(f.ctx, cards);
    expect(activeHold(f.state(), 253)?.prerequisites).toEqual([242, 243]);
    expect(f.comments).toHaveLength(1);
  });

  it('releases the hold once both have merged, with no author answer, and keeps the record', async () => {
    const f = fake({ 253: BODY_253 });
    await settleHolds(f.ctx, cards);
    f.merged.add(242);
    f.merged.add(243);
    await settleHolds(f.ctx, cards);
    expect(activeHold(f.state(), 253)).toBeNull();
    expect(f.state().holds['253']).toMatchObject({ prerequisites: [242, 243], released: '2026-10-05T10:00:00.000Z' });
    expect(f.comments).toHaveLength(2);
    expect(f.comments[1]).toContain('released');
    await settleHolds(f.ctx, cards);
    expect(f.comments).toHaveLength(2);
  });

  it('records no hold when the prerequisites already merged', async () => {
    const f = fake({ 253: BODY_253 });
    f.merged.add(242);
    f.merged.add(243);
    await settleHolds(f.ctx, cards);
    expect(f.state().holds).toEqual({});
    expect(f.comments).toEqual([]);
  });

  it('records no hold for incidental issue mentions', async () => {
    const f = fake({ 253: 'Make the radio louder. Related to #100, see #99.' });
    await settleHolds(f.ctx, cards);
    expect(f.state().holds).toEqual({});
    expect(f.comments).toEqual([]);
  });

  it('counts a prerequisite bundled into a lead by the lead\'s merge', async () => {
    const f = fake({ 253: BODY_253 }, [], { bundles: { '240': [242] } });
    await settleHolds(f.ctx, cards);
    f.merged.add(243);
    await settleHolds(f.ctx, cards);
    expect(activeHold(f.state(), 253)).not.toBeNull();
    f.merged.add(240);
    await settleHolds(f.ctx, cards);
    expect(activeHold(f.state(), 253)).toBeNull();
  });

  it('counts an unreadable merge as not merged', async () => {
    const f = fake({ 253: BODY_253 });
    f.ctx.repo.issueMerged = async () => { throw new Error('no such ref'); };
    await settleHolds(f.ctx, cards);
    expect(activeHold(f.state(), 253)).not.toBeNull();
  });

  it('reads each issue once and calls GitHub for nothing while no hold stands', async () => {
    const f = fake({ 1: 'Plain.', 2: 'Plain.', 253: BODY_253 });
    const board = [card(1, 'Triage'), card(2, 'Design'), card(3, 'Done'), card(253, 'Design')];
    await settleHolds(f.ctx, board);
    expect(f.reads.sort()).toEqual([1, 2, 253]);
    await settleHolds(f.ctx, board);
    await settleHolds(f.ctx, board);
    expect(f.reads).toHaveLength(3);
    expect(f.comments).toHaveLength(1);
  });

  it('removes the stuck label of a hand-made wait, and never one with a failed job on record', async () => {
    const plain = fake({ 253: BODY_253 });
    const after = await settleHolds(plain.ctx, [card(253, 'Design', [STUCK_LABEL])]);
    expect(plain.removed).toEqual([`253:${STUCK_LABEL}`]);
    expect(after[0].labels).toEqual([]);
    const failed = fake({ 253: BODY_253 }, [], { failures: [{ stage: 'design', issue: 253, error: 'boom', log: null, at: '2026-10-05T09:00:00.000Z' }] });
    const kept = await settleHolds(failed.ctx, [card(253, 'Design', [STUCK_LABEL])]);
    expect(failed.removed).toEqual([]);
    expect(kept[0].labels).toEqual([STUCK_LABEL]);
    expect(activeHold(failed.state(), 253)).not.toBeNull();
  });

  it('keeps the stuck label of an issue the ledger shows a failed job for', async () => {
    const f = fake({ 253: BODY_253 });
    const { appendLedger } = await import('./ledger');
    appendLedger(f.ctx.cfg.home, { kind: 'job', id: 'design-253', stage: 'design', issue: 253, startedAt: '2026-10-01T00:00:00.000Z', endedAt: '2026-10-01T00:10:00.000Z', outcome: 'timeout', agents: [] });
    await settleHolds(f.ctx, [card(253, 'Design', [STUCK_LABEL])]);
    expect(f.removed).toEqual([]);
  });

  it('moves a card that Design sent back with answered questions to Design again, and leaves a genuine open question alone', async () => {
    const answered = [factory('Triage passed: clear.'), asked, author('Yes, wait.')];
    const f = fake({ 253: BODY_253 }, answered);
    const after = await settleHolds(f.ctx, [card(253, 'Triage')]);
    expect(f.moved).toEqual(['253:Design']);
    expect(after[0].column).toBe('Design');
    const open = fake({ 253: BODY_253 }, [factory('Triage passed: clear.'), asked]);
    const waiting = await settleHolds(open.ctx, [card(253, 'Triage', [NEEDS_INFO_LABEL])]);
    expect(open.moved).toEqual([]);
    expect(waiting[0]).toMatchObject({ column: 'Triage', labels: [NEEDS_INFO_LABEL] });
  });

  it('does not move a Triage card whose questions came from Triage itself', async () => {
    const f = fake({ 253: BODY_253 }, [asked, author('Yes.'), factory('Triage passed: clear.')]);
    await settleHolds(f.ctx, [card(253, 'Triage')]);
    expect(f.moved).toEqual([]);
  });
});
