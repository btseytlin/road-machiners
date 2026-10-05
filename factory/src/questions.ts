import { FACTORY_MARK, QUESTIONS_HEADING, type IssueComment } from './types';

function isFactory(comment: IssueComment): boolean {
  return comment.body.includes(FACTORY_MARK);
}

export function isFactoryQuestion(comment: IssueComment): boolean {
  return isFactory(comment) && comment.body.startsWith(QUESTIONS_HEADING);
}

// The factory asked and someone replied. The factory posts from a member's account, so only the marker tells its comments apart.
export function isAnswered(comments: IssueComment[]): boolean {
  const asked = comments.map(isFactoryQuestion).lastIndexOf(true);
  if (asked < 0) return false;
  return comments.slice(asked + 1).some((comment) => !isFactory(comment));
}

const normalize = (text: string): string => text.toLowerCase().replace(/^\s*\d+[.)]\s*/, '').replace(/[^a-z0-9#]+/g, ' ').trim();
const WAIT_WORDS = /\b(?:wait|waits|waiting|merge|merged|merges|land|lands|landed|depend|depends|dependency|first|before|after|block|blocked)\b/i;

// The numbered questions of every factory question comment that someone answered afterwards.
function answeredQuestions(comments: IssueComment[]): Set<string> {
  const answered = new Set<string>();
  comments.forEach((comment, index) => {
    if (!isFactoryQuestion(comment) || !comments.slice(index + 1).some((later) => !isFactory(later))) return;
    for (const line of comment.body.split('\n')) if (/^\d+\.\s/.test(line)) answered.add(normalize(line));
  });
  return answered;
}

// Drops the questions the author already answered, and the ones that ask whether to wait for an issue the dependency hold already covers.
export function freshQuestions(comments: IssueComment[], proposed: string[], covered: number[]): string[] {
  const answered = answeredQuestions(comments);
  const aboutHold = (question: string): boolean => WAIT_WORDS.test(question) && [...question.matchAll(/#(\d+)\b/g)].some((match) => covered.includes(Number(match[1])));
  return proposed.filter((question) => !answered.has(normalize(question)) && !aboutHold(question));
}
