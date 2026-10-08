// The rules of the release playtest that need no agent: what the run log proves and whether a review may pass it.
// The factory computes the facts, so a review cannot pass a run that crashed, ended early with no word on it or did nothing.

export type Ending = 'complete' | 'death' | 'error';
export type LogSummary = { turns: number; shots: number; destroyed: number; knockouts: number; deaths: number; stalls: number; moneyIn: number; moneyOut: number; npcGoals: Record<string, number>; playerTiles: number };
export type LogFacts = { seed: number; turns: number; sha: string | null; lines: number; events: number; ending: Ending; endTurn: number; message: string | null; summary: LogSummary; quiet: string[] };

export type Finding = { id: string; severity: 'important' | 'minor'; title: string; evidence: string; cause: 'release' | 'old'; why: string; known: number | null };
export type Review = {
  verdict: 'clean' | 'fixed' | 'blocked';
  summary: string;
  drama: string;
  observations: string[];
  suspected: string[];
  limitations: string[];
  findings: Finding[];
  fixes: string[];
  explanations: { death: string | null; quiet: string | null };
  blocker: string | null;
};
export type Outcome = { outcome: 'clean' | 'replay' | 'blocked'; reason: string };
export type PlayState = { moved: boolean; last: boolean };

type Line = Record<string, unknown> & { k?: string };

export function logFacts(text: string, want: { seed: number; turns: number; sha: string }): LogFacts {
  const lines = text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Line);
  const header = only(lines, 'run');
  const end = only(lines, 'end');
  const summary = only(lines, 'summary') as unknown as LogSummary;
  if (header.seed !== want.seed || header.turns !== want.turns || header.sha !== want.sha) {
    throw new Error(`The playtest log is of seed ${String(header.seed)}, ${String(header.turns)} turns at ${String(header.sha)}, not seed ${want.seed}, ${want.turns} turns at ${want.sha}`);
  }
  const events = lines.filter((line) => line.k === 'event').length;
  return { seed: want.seed, turns: want.turns, sha: want.sha, lines: lines.length, events, ending: end.reason as Ending, endTurn: end.turn as number, message: (end.message as string | null) ?? null, summary, quiet: quietParts(summary) };
}

function only(lines: Line[], kind: string): Line {
  const found = lines.filter((line) => line.k === kind);
  if (found.length !== 1) throw new Error(`The playtest log has ${found.length} ${kind} lines, not one`);
  return found[0];
}

export function quietParts(summary: LogSummary): string[] {
  const parts: string[] = [];
  if (summary.shots === 0) parts.push('no shots were fired');
  if (summary.moneyIn + summary.moneyOut === 0) parts.push("the player's money never changed");
  if (Object.keys(summary.npcGoals).length === 0) parts.push('no NPC took up a goal');
  if (summary.playerTiles === 0) parts.push('the player truck never moved');
  return parts;
}

const VERDICTS = ['clean', 'fixed', 'blocked'];
const SEVERITIES = ['important', 'minor'];
const CAUSES = ['release', 'old'];
const LISTS = ['observations', 'suspected', 'limitations', 'findings', 'fixes'] as const;

export function readReview(text: string | null): Review {
  if (text === null) throw new Error('The playtest agent wrote no .factory/playtest.json');
  const review = JSON.parse(text) as Review;
  if (!VERDICTS.includes(review.verdict)) throw new Error(`The playtest verdict ${String(review.verdict)} is not clean, fixed or blocked`);
  const missing = LISTS.find((key) => !Array.isArray(review[key]));
  if (missing) throw new Error(`The playtest review has no ${missing} list`);
  return { ...review, findings: review.findings.map(readFinding), explanations: explanationsOf(review.explanations), blocker: review.blocker ?? null };
}

const FINDING_RULES: ((finding: Finding) => string | null)[] = [
  (finding) => (SEVERITIES.includes(finding.severity) ? null : `has severity ${String(finding.severity)}, not important or minor`),
  (finding) => (CAUSES.includes(finding.cause) ? null : `has cause ${String(finding.cause)}, not release or old`),
  (finding) => (typeof finding.why === 'string' && finding.why.trim() !== '' ? null : 'gives no reason for its cause'),
  (finding) => (finding.known === null || Number.isInteger(finding.known) ? null : `has known ${String(finding.known)}, not an issue number or null`),
];

function readFinding(given: Finding): Finding {
  const finding = { ...given, known: given.known ?? null };
  for (const rule of FINDING_RULES) {
    const reason = rule(finding);
    if (reason !== null) throw new Error(`Finding ${finding.id} ${reason}`);
  }
  return finding;
}

function explanationsOf(given: Partial<Review['explanations']> | undefined): Review['explanations'] {
  return { death: given?.death ?? null, quiet: given?.quiet ?? null };
}

export function judge(facts: LogFacts, review: Review, play: PlayState): Outcome {
  if (review.verdict === 'blocked') return { outcome: 'blocked', reason: review.blocker ?? review.summary };
  if (review.verdict === 'fixed' && !play.moved) return { outcome: 'blocked', reason: 'The review says it fixed findings but committed nothing.' };
  if (play.moved) return replay(review, play.last);
  return judgeClean(facts, review);
}

function replay(review: Review, last: boolean): Outcome {
  const fixes = review.fixes.length ? review.fixes.join('; ') : 'commits with no fix named';
  if (last) return { outcome: 'blocked', reason: `The last play left fixes that no play checked: ${fixes}.` };
  return { outcome: 'replay', reason: `${review.fixes.length} fixes to replay` };
}

const CLEAN_RULES: ((facts: LogFacts, review: Review) => string | null)[] = [
  (facts) => (facts.ending === 'error' ? `The run ended in an error at turn ${facts.endTurn}, so it cannot be clean: ${facts.message ?? 'no message'}` : null),
  (_facts, review) => {
    const important = review.findings.filter((finding) => finding.severity === 'important' && finding.cause === 'release').length;
    return important > 0 ? `The review called the run clean with ${important} important findings the release caused.` : null;
  },
  (facts, review) => ((facts.ending === 'death' || facts.summary.deaths > 0) && !review.explanations.death ? 'The player died in the run, and the clean review does not explain the death.' : null),
  (facts, review) => (facts.quiet.length > 0 && !review.explanations.quiet ? `The run was quiet (${facts.quiet.join(', ')}), and the clean review does not explain it.` : null),
];

function judgeClean(facts: LogFacts, review: Review): Outcome {
  for (const rule of CLEAN_RULES) {
    const reason = rule(facts, review);
    if (reason !== null) return { outcome: 'blocked', reason };
  }
  return { outcome: 'clean', reason: 'clean' };
}
