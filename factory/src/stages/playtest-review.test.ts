import { describe, expect, it } from 'vitest';
import { judge, logFacts, readReview, type LogFacts, type Review } from './playtest-review';
import { WANT, logText } from './playtest-fixtures';


const review = (over: Partial<Review> = {}): Review => ({
  verdict: 'clean', summary: 's', drama: 'd', observations: [], suspected: [], limitations: ['far mode'], findings: [], plan: [],
  explanations: { death: null, quiet: null }, blocker: null, ...over,
});
const important = { id: 'F1', severity: 'important' as const, title: 'Raiders never stop', evidence: 'turn 40' };
const facts = (over: Partial<LogFacts> = {}): LogFacts => ({ ...logFacts(logText(), WANT), ...over });

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
    expect(() => readReview(JSON.stringify({ ...review(), plan: undefined }))).toThrow('no plan list');
  });

  it('fills missing explanations and blocker with null', () => {
    const { explanations: _e, blocker: _b, ...rest } = review();
    expect(readReview(JSON.stringify(rest))).toMatchObject({ explanations: { death: null, quiet: null }, blocker: null });
  });
});

describe('judge', () => {
  it('passes a clean review of a finished run with no important finding', () => {
    expect(judge(facts(), review({ findings: [{ ...important, severity: 'minor' }] }))).toEqual({ outcome: 'clean', reason: 'clean' });
  });

  it('blocks a clean review of a run that ended in an error', () => {
    expect(judge(facts({ ending: 'error', message: 'stalled' }), review()).reason).toContain('ended in an error at turn 101');
  });

  it('blocks a clean review that still lists an important finding', () => {
    expect(judge(facts(), review({ findings: [important] }))).toEqual({ outcome: 'blocked', reason: 'The review called the run clean with 1 important findings.' });
  });

  it('blocks a clean review that leaves a death or a quiet run unexplained, and passes an explained one', () => {
    const died = facts({ ending: 'death' });
    expect(judge(died, review()).outcome).toBe('blocked');
    expect(judge(died, review({ explanations: { death: 'raiders at turn 80 after the bot ignored low health', quiet: null } })).outcome).toBe('clean');
    const quiet = facts({ quiet: ['no shots were fired'] });
    expect(judge(quiet, review()).reason).toContain('quiet (no shots were fired)');
    expect(judge(quiet, review({ explanations: { death: null, quiet: 'the fighter day found no target in range' } })).outcome).toBe('clean');
  });

  it('asks for fixes only with an important finding and a plan', () => {
    const plan = [{ priority: 1, finding: 'F1', change: 'end the raid goal', tests: 'npc-decisions' }];
    expect(judge(facts(), review({ verdict: 'fix', findings: [important], plan }))).toEqual({ outcome: 'fix', reason: '1 planned fixes' });
    expect(judge(facts(), review({ verdict: 'fix', findings: [important] })).outcome).toBe('blocked');
    expect(judge(facts(), review({ verdict: 'fix', plan })).outcome).toBe('blocked');
  });

  it('blocks with the reviewer reason on a blocked verdict', () => {
    expect(judge(facts(), review({ verdict: 'blocked', blocker: 'Should raiders flee at night? A design call.' }))).toEqual({ outcome: 'blocked', reason: 'Should raiders flee at night? A design call.' });
  });
});
