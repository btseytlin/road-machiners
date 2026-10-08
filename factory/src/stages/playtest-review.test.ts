import { describe, expect, it } from 'vitest';
import { judge, logFacts, readReview, type LogFacts, type Review } from './playtest-review';
import { WANT, logText } from './playtest-fixtures';


const review = (over: Partial<Review> = {}): Review => ({
  verdict: 'clean', summary: 's', drama: 'd', observations: [], suspected: [], limitations: ['far mode'], findings: [], fixes: [],
  explanations: { death: null, quiet: null }, blocker: null, ...over,
});
const important = { id: 'F1', severity: 'important' as const, title: 'Raiders never stop', evidence: 'turn 40', cause: 'release' as const, why: 'the raid goal of #12 never ends', known: null };
const old = { ...important, id: 'F2', cause: 'old' as const, why: 'the baseline log shows the same loop at turn 300' };
const facts = (over: Partial<LogFacts> = {}): LogFacts => ({ ...logFacts(logText(), WANT), ...over });
const play = { moved: false, last: false };

describe('logFacts', () => {
  it('reads the ending, the event count and the summary of the run', () => {
    const read = logFacts(logText(), WANT);
    expect(read).toMatchObject({ seed: WANT.seed, turns: 100, sha: 'abc1234', lines: 5, events: 1, ending: 'complete', endTurn: 101, message: null, quiet: [] });
  });

  it('names each kind of activity the run never showed', () => {
    const read = logFacts(logText({ summary: { shots: 0, moneyIn: 0, moneyOut: 0, npcGoals: {}, playerTiles: 0 } }), WANT);
    expect(read.quiet).toEqual(['no shots were fired', "the player's money never changed", 'no NPC took up a goal', 'the player truck never moved']);
  });

  it('fails on a log of another seed, turn count or commit, so a review never passes a run it did not get', () => {
    expect(() => logFacts(logText({ header: { sha: 'old0001' } }), WANT)).toThrow('at old0001, not seed 20261007, 100 turns at abc1234');
    expect(() => logFacts(logText({ header: { seed: 1 } }), WANT)).toThrow('of seed 1');
    expect(() => logFacts(logText({ header: { turns: 5 } }), WANT)).toThrow('5 turns');
  });

  it('fails on a log without its end or summary', () => {
    const cut = logText().split('\n').slice(0, 3).join('\n');
    expect(() => logFacts(cut, WANT)).toThrow('0 end lines');
  });
});

describe('readReview', () => {
  it('fails on a missing review, an unknown verdict or severity, or a missing list', () => {
    expect(() => readReview(null)).toThrow('wrote no .factory/playtest.json');
    expect(() => readReview(JSON.stringify(review({ verdict: 'ok' as Review['verdict'] })))).toThrow('verdict ok');
    expect(() => readReview(JSON.stringify(review({ findings: [{ ...important, severity: 'big' as 'important' }] })))).toThrow('severity big');
    expect(() => readReview(JSON.stringify({ ...review(), fixes: undefined }))).toThrow('no fixes list');
  });

  it('fails on a finding with no cause, no reason for its cause or a known issue that is not a number', () => {
    expect(() => readReview(JSON.stringify(review({ findings: [{ ...important, cause: 'maybe' as 'old' }] })))).toThrow('Finding F1 has cause maybe, not release or old');
    expect(() => readReview(JSON.stringify(review({ findings: [{ ...important, why: ' ' }] })))).toThrow('Finding F1 gives no reason for its cause');
    expect(() => readReview(JSON.stringify(review({ findings: [{ ...old, known: '12' as unknown as number }] })))).toThrow('Finding F2 has known 12, not an issue number or null');
  });

  it('fills missing explanations, blocker and known with null', () => {
    const { explanations: _e, blocker: _b, ...rest } = review();
    expect(readReview(JSON.stringify(rest))).toMatchObject({ explanations: { death: null, quiet: null }, blocker: null });
    const { known: _k, ...unknown } = old;
    expect(readReview(JSON.stringify(review({ findings: [unknown as typeof old] }))).findings[0].known).toBeNull();
  });
});

describe('judge', () => {
  it('passes a clean review of a finished run with no important release finding, also with important old ones', () => {
    expect(judge(facts(), review({ findings: [{ ...important, severity: 'minor' }, old] }), play)).toEqual({ outcome: 'clean', reason: 'clean' });
  });

  it('blocks a clean review of a run that ended in an error', () => {
    expect(judge(facts({ ending: 'error', message: 'stalled' }), review(), play).reason).toContain('ended in an error at turn 101');
  });

  it('blocks a clean review that still lists an important release finding', () => {
    expect(judge(facts(), review({ findings: [important] }), play)).toEqual({ outcome: 'blocked', reason: 'The review called the run clean with 1 important findings the release caused.' });
  });

  it('blocks a clean review that leaves a death or a quiet run unexplained, and passes an explained one', () => {
    const died = facts({ ending: 'death' });
    expect(judge(died, review(), play).outcome).toBe('blocked');
    expect(judge(died, review({ explanations: { death: 'raiders at turn 80 after the bot ignored low health', quiet: null } }), play).outcome).toBe('clean');
    const quiet = facts({ quiet: ['no shots were fired'] });
    expect(judge(quiet, review(), play).reason).toContain('quiet (no shots were fired)');
    expect(judge(quiet, review({ explanations: { death: null, quiet: 'the fighter day found no target in range' } }), play).outcome).toBe('clean');
  });

  it('replays after fixes the agent committed, and blocks fixes with no commit', () => {
    expect(judge(facts(), review({ verdict: 'fixed', fixes: ['end the raid goal'] }), { moved: true, last: false })).toEqual({ outcome: 'replay', reason: '1 fixes to replay' });
    expect(judge(facts(), review({ verdict: 'fixed', fixes: ['end the raid goal'] }), play)).toEqual({ outcome: 'blocked', reason: 'The review says it fixed findings but committed nothing.' });
  });

  it('replays a clean review that committed anyway, since its commits were never played', () => {
    expect(judge(facts(), review(), { moved: true, last: false }).outcome).toBe('replay');
  });

  it('blocks on the last play when commits are left to replay', () => {
    expect(judge(facts(), review({ verdict: 'fixed', fixes: ['a'] }), { moved: true, last: true }).reason).toBe('The last play left fixes that no play checked: a.');
    expect(judge(facts(), review(), { moved: true, last: true }).outcome).toBe('blocked');
    expect(judge(facts(), review(), { moved: false, last: true }).outcome).toBe('clean');
  });

  it('blocks with the reviewer reason on a blocked verdict', () => {
    expect(judge(facts(), review({ verdict: 'blocked', blocker: 'Should raiders flee at night? A design call.' }), play)).toEqual({ outcome: 'blocked', reason: 'Should raiders flee at night? A design call.' });
  });
});
