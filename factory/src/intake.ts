import { addCard } from './card-events';
import { githubLogins, readCommittee } from './committee';
import { CANDIDATE_LABELS, HOTFIX_LABEL } from './types';
import type { Ctx, Issue } from './types';

type MarkRules = { minVotes: number; minAgeHours: number; committee: string[] };

const HOUR_MS = 3_600_000;

// An issue is marked when it is old enough and has enough thumbs-up or one from the committee.
export function isMarked(issue: Issue, now: Date, rules: MarkRules): boolean {
  const ageHours = (now.getTime() - new Date(issue.createdAt).getTime()) / HOUR_MS;
  if (ageHours < rules.minAgeHours) return false;
  const byCommittee = issue.thumbsUp.some((login) => rules.committee.includes(login));
  return byCommittee || issue.thumbsUp.length >= rules.minVotes;
}

// Puts every marked issue that is not yet on the board into Triage.
// A hotfix goes straight to Design with no votes, since a collaborator chose it by its label.
export async function intake(ctx: Ctx): Promise<number[]> {
  const { cfg, github } = ctx;
  const bootstrap = { telegram: cfg.committeeBootstrapTelegram, github: cfg.committeeBootstrapGithub };
  const rules = { minVotes: cfg.minVotes, minAgeHours: cfg.minAgeHours, committee: githubLogins(readCommittee(cfg.home, bootstrap)) };
  const onBoard = new Set((await github.cards()).map((card) => card.issue));
  const candidates = await github.candidates([...CANDIDATE_LABELS, HOTFIX_LABEL]);
  const added: number[] = [];
  for (const issue of candidates) {
    const hotfix = issue.labels.includes(HOTFIX_LABEL);
    if (onBoard.has(issue.number) || !(hotfix || isMarked(issue, ctx.now(), rules))) continue;
    await addToBoard(ctx, issue.number, hotfix);
    added.push(issue.number);
  }
  return added;
}

async function addToBoard(ctx: Ctx, issue: number, hotfix: boolean): Promise<void> {
  const column = hotfix ? 'Design' : 'Triage';
  await addCard(ctx, issue, column, hotfix ? 'hotfix' : undefined);
  await ctx.github.comment(issue, hotfix ? 'The factory picked this up as a hotfix. It goes to design now.' : 'The factory picked this up for triage.');
  ctx.log('intake', issue, `added to ${column}`);
}
