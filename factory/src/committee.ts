import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Member = { telegram: string; github: string | null; name: string | null };

export function committeePath(home: string): string {
  return join(home, 'committee', 'committee.json');
}

export function readCommittee(home: string, bootstrap: { telegram: string; github: string }): Member[] {
  const path = committeePath(home);
  if (!existsSync(path)) return [{ telegram: bootstrap.telegram, github: bootstrap.github, name: null }];
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const members = (data as { members?: unknown } | null)?.members;
  if (!Array.isArray(members)) throw new Error(`${path} needs a "members" list.`);
  return members.map((item, index) => parseMember(item, `${path} member ${index}`));
}

function parseMember(item: unknown, where: string): Member {
  const member = item as Record<string, unknown> | null;
  if (typeof member !== 'object' || member === null) throw new Error(`${where} is not an object.`);
  const { telegram, github, name } = member;
  if (typeof telegram !== 'string' || !/^\d+$/.test(telegram)) throw new Error(`${where} needs a numeric telegram id string.`);
  return { telegram, github: nullableString(github, `${where} github`), name: nullableString(name, `${where} name`) };
}

function nullableString(value: unknown, where: string): string | null {
  if (value === null || typeof value === 'string') return value;
  throw new Error(`${where} must be a string or null.`);
}

export function githubLogins(members: Member[]): string[] {
  return members.flatMap((member) => (member.github ? [member.github] : []));
}

export function telegramIds(members: Member[]): string[] {
  return members.map((member) => member.telegram);
}
