import { FACTORY_MARK, QUESTIONS_HEADING, type IssueComment } from './types';

function isFactory(comment: IssueComment): boolean {
  return comment.body.includes(FACTORY_MARK);
}

function isQuestion(comment: IssueComment): boolean {
  return isFactory(comment) && comment.body.startsWith(QUESTIONS_HEADING);
}

// When the factory last asked, or null when it never did.
export function askedAt(comments: IssueComment[]): string | null {
  const asked = comments.map(isQuestion).lastIndexOf(true);
  return asked < 0 ? null : comments[asked].createdAt;
}

// The factory asked and someone replied. The factory posts from a member's account, so only the marker tells its comments apart.
export function isAnswered(comments: IssueComment[]): boolean {
  const asked = comments.map(isQuestion).lastIndexOf(true);
  if (asked < 0) return false;
  return comments.slice(asked + 1).some((comment) => !isFactory(comment));
}
