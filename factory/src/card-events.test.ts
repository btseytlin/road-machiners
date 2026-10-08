import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { addCard, cardFlow, moveCard } from './card-events';
import { readLedger } from './ledger';
import type { Ctx } from './types';

let home = '';
let calls: string[] = [];
beforeEach(() => { home = mkdtempSync(resolve('tmp/card-events-')); calls = []; });
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(failMove = false): Ctx {
  return {
    cfg: { home }, now: () => new Date('2026-10-01T09:00:00Z'),
    github: {
      move: async (issue: number, column: string) => { if (failMove) throw new Error('board down'); calls.push(`move ${issue} ${column}`); },
      addCard: async (issue: number, column: string) => { calls.push(`addCard ${issue} ${column}`); },
    },
  } as unknown as Ctx;
}

it('records each move after the board takes it, with its step and flow and no text', async () => {
  await addCard(fakeCtx(), 4, 'Triage');
  await moveCard(fakeCtx(), 4, 'Design', 'accepted', 'hotfix');
  expect(calls).toEqual(['addCard 4 Triage', 'move 4 Design']);
  expect(readLedger(home, new Date(0))).toEqual([
    { kind: 'card', issue: 4, step: 'entered', to: 'Triage', at: '2026-10-01T09:00:00.000Z' },
    { kind: 'card', issue: 4, step: 'accepted', to: 'Design', at: '2026-10-01T09:00:00.000Z', flow: 'hotfix' },
  ]);
});

it('records nothing when the board refuses the move', async () => {
  await expect(moveCard(fakeCtx(true), 4, 'Design', 'accepted')).rejects.toThrow('board down');
  expect(readLedger(home, new Date(0))).toEqual([]);
});

it('reads the flow of a card from its labels', () => {
  expect(cardFlow(['bug'])).toBeUndefined();
  expect(cardFlow(['hotfix', 'bug'])).toBe('hotfix');
  expect(cardFlow(['release-task', 'maintenance'])).toBe('release-task');
  expect(cardFlow(['release'])).toBe('release');
  expect(cardFlow(['adhoc'])).toBe('adhoc');
});

it('leaves every board move to the helper', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
  const direct = files(resolve('src')).filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('card-events.ts'))
    .filter((path) => /github\.(move|addCard)\(/.test(readFileSync(path, 'utf8')));
  expect(direct).toEqual([]);
});
