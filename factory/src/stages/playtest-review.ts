// The rules of the release playtest that need no agent: what the run log proves and whether a review may pass it.
// The factory computes the facts, so a review cannot pass a run that crashed, ended early with no word on it or did nothing.

export type Ending = 'complete' | 'death' | 'error';
// The game's summary line, with the counts the gate checks. The agent reads the rest.
export type LogSummary = { turns: number; shots: number; destroyed: number; knockouts: number; deaths: number; stalls: number; moneyIn: number; moneyOut: number; npcGoals: Record<string, number>; playerTiles: number };
export type LogFacts = { seed: number; turns: number; sha: string | null; lines: number; events: number; ending: Ending; endTurn: number; message: string | null; summary: LogSummary; quiet: string[] };

export type Finding = { id: string; severity: 'important' | 'minor'; title: string; evidence: string };
export type PlanStep = { priority: number; finding: string; change: string; tests: string };
export type Review = {
  verdict: 'clean' | 'fix' | 'blocked';
  summary: string;
  drama: string;
  observations: string[];
  suspected: string[];
  limitations: string[];
  findings: Finding[];
  plan: PlanStep[];
  explanations: { death: string | null; quiet: string | null };
  blocker: string | null;
};
export type Outcome = { outcome: 'clean' | 'fix' | 'blocked'; reason: string };

type Line = Record<string, unknown> & { k?: string };

// Reads the run log the harness wrote. A log without its header, end or summary, or one for another run, means the
// harness broke, which fails the job: there is nothing to review.
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

// Kinds of activity the run never showed. A clean verdict must explain each one.
export function quietParts(summary: LogSummary): string[] {
  const parts: string[] = [];
  if (summary.shots === 0) parts.push('no shots were fired');
  if (summary.moneyIn + summary.moneyOut === 0) parts.push('no money changed hands');
  if (Object.keys(summary.npcGoals).length === 0) parts.push('no NPC took up a goal');
  if (summary.playerTiles === 0) parts.push('the player truck never moved');
  return parts;
}

const VERDICTS = ['clean', 'fix', 'blocked'];
const SEVERITIES = ['important', 'minor'];
const LISTS = ['observations', 'suspected', 'limitations', 'findings', 'plan'] as const;

// Reads .factory/playtest.json. A missing or malformed review is an agent failure and fails the job.
export function readReview(text: string | null): Review {
  if (text === null) throw new Error('The playtest agent wrote no .factory/playtest.json');
  const review = JSON.parse(text) as Review;
  if (!VERDICTS.includes(review.verdict)) throw new Error(`The playtest verdict ${String(review.verdict)} is not clean, fix or blocked`);
  const missing = LISTS.find((key) => !Array.isArray(review[key]));
  if (missing) throw new Error(`The playtest review has no ${missing} list`);
  const odd = review.findings.find((finding) => !SEVERITIES.includes(finding.severity));
  if (odd) throw new Error(`Finding ${odd.id} has severity ${String(odd.severity)}, not important or minor`);
  return { ...review, explanations: explanationsOf(review.explanations), blocker: review.blocker ?? null };
}

function explanationsOf(given: Partial<Review['explanations']> | undefined): Review['explanations'] {
  return { death: given?.death ?? null, quiet: given?.quiet ?? null };
}

// Turns the agent's verdict into the gate's outcome. A clean verdict passes only with a finished run, no important
// finding and a reason for every death and every quiet part. Anything that does not hold blocks the release.
export function judge(facts: LogFacts, review: Review): Outcome {
  if (review.verdict === 'blocked') return { outcome: 'blocked', reason: review.blocker ?? review.summary };
  if (review.verdict === 'fix') return judgeFix(review);
  return judgeClean(facts, review);
}

function judgeFix(review: Review): Outcome {
  if (review.plan.length === 0) return { outcome: 'blocked', reason: 'The review asked for fixes but wrote no plan.' };
  if (!review.findings.some((finding) => finding.severity === 'important')) return { outcome: 'blocked', reason: 'The review asked for fixes but named no important finding.' };
  return { outcome: 'fix', reason: `${review.plan.length} planned fixes` };
}

// The rules a clean verdict must meet, in order. Each returns the reason it fails, or null.
const CLEAN_RULES: ((facts: LogFacts, review: Review) => string | null)[] = [
  (facts) => (facts.ending === 'error' ? `The run ended in an error at turn ${facts.endTurn}, so it cannot be clean: ${facts.message ?? 'no message'}` : null),
  (_facts, review) => {
    const important = review.findings.filter((finding) => finding.severity === 'important').length;
    return important > 0 ? `The review called the run clean with ${important} important findings.` : null;
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
