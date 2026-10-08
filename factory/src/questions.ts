import { FACTORY_MARK, QUESTIONS_HEADING, type IssueComment } from './types';

function isFactory(comment: IssueComment): boolean {
  return comment.body.includes(FACTORY_MARK);
}

function isQuestion(comment: IssueComment): boolean {
  return isFactory(comment) && comment.body.startsWith(QUESTIONS_HEADING);
}

export function askedAt(comments: IssueComment[]): string | null {
  const asked = comments.map(isQuestion).lastIndexOf(true);
  return asked < 0 ? null : comments[asked].createdAt;
}

export function isAnswered(comments: IssueComment[]): boolean {
  const asked = comments.map(isQuestion).lastIndexOf(true);
  if (asked < 0) return false;
  return comments.slice(asked + 1).some((comment) => !isFactory(comment));
}

const SEQUENCE = String.raw`prerequisites?|depends? on|dependency|dependencies|blocked by|wait(?:s|ing)? (?:for|until)|merged|lands?|landed|ships?|shipped`;
const OPERATIONS = [
  /\bgit\b|\brebas(?:e|ed|ing)\b|\bcherry-?pick|\bworktrees?\b|\b(?:work|git|local|stale|fresh|host|my|this) clones?\b|\bclone (?:is|was) (?:stale|old|behind|out of date)\b|\bre-?clon(?:e|ed|ing)\b|\bpull (?:the )?latest\b/i,
  /\borigin\/|\bfactory\/issue-|`(?:dev|main)`|\b(?:dev|release|feature|issue|base|work|stale|git) branch(?:es)?\b|\bmain branch\b(?! of)|\bbranch(?:es)? (?:dev|main)\b|\b(?:in|into|onto|from|latest|pull|sync|rebase|update(?:d)? to) (?:the )?dev\b(?! console| team| tools?| mode| menu)|\b(?:the|a|this|that|its|my) branch (?:for|of) #\d+|#\d+(?:['’]s)? branch\b/i,
  /\bpull requests?\b|\bPRs?\b|\bmerge conflicts?\b|\bmerg(?:e|ed|es|ing)\b[^.?!]{0,40}\b(?:branch(?:es)?\b(?! of)|pull request\b|PR\b)/i,
  /\b(?:npm|vitest|typecheck|tsc|lint|CI)\b|\btest suite\b|\bunit tests?\b|\bfailing tests?\b|\bthe build (?:fails|failed|is broken|breaks)\b/i,
  new RegExp(String.raw`\b(?:${SEQUENCE})\b[^.?!]{0,40}#\d+|#\d+[^.?!]{0,40}\b(?:${SEQUENCE}|first|(?:is|are) (?:done|finished|ready|complete))\b`, 'i'),
];

export function operationsQuestions(questions: string[]): string[] {
  return questions.filter((question) => OPERATIONS.some((pattern) => pattern.test(question)));
}
