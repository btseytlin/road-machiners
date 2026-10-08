import { EMPTY_STATE, writeState } from '../state';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { agentHome } from './common';
import { MergeConflictError, RevertConflictError, type AgentRun, type Card, type Ctx, type FactoryConfig, type InlineButton, type MergeStep, type Resolution } from '../types';

export const ROOT = resolve(`tmp/factory-periodic-test/${randomUUID()}`);
export const cfg = { home: ROOT, buildModel: 'sonnet', publicChannel: 'public', committeeChat: 'committee', repo: 'o/r', transcriptDays: 10, publicUrl: 'https://play.test/play', errorMapDays: 14 } as FactoryConfig;
export const CLONE_SHA = 'abc1234'.padEnd(40, '0');

export type Photo = { chat: string; path: string; caption: string; buttons?: InlineButton[][] };
export type Album = { chat: string; paths: string[]; captions: string[]; replyTo?: number };
export type Text = { chat: string; text: string; buttons: InlineButton[][] };
export type Fake = { ctx: Ctx; texts: Text[]; calls: string[]; agentWrites: Record<string, string>; changelog: string[]; diff: string; cards: Card[]; photos: Photo[]; albums: Album[]; albumFails: boolean; prBodies: string[]; created: { title: string; body: string; labels: string[] }[]; mergeConflicts: string[]; revertConflicts: string[]; agentRuns: AgentRun[] };

export function fake(): Fake {
  const f: Fake = { texts: [], ctx: null as unknown as Ctx, calls: [], agentWrites: {}, changelog: [], diff: '', cards: [], photos: [], albums: [], albumFails: false, prBodies: [], created: [], mergeConflicts: [], revertConflicts: [], agentRuns: [] };
  const note = (text: string) => { f.calls.push(text); };
  f.ctx = {
    cfg,
    statePath: join(ROOT, 'state.json'),
    now: () => new Date('2026-09-29T10:00:00Z'),
    log: () => undefined,
    run: async (cmd: string, args: string[]) => { note(`run ${cmd} ${args.join(' ')}`); return { code: 0, stdout: cmd === 'git' && args[0] === 'rev-parse' ? `${CLONE_SHA}\n` : '', stderr: '' }; },
    github: {
      createIssue: async (title: string, body: string, labels: string[]) => { note(`createIssue ${title}`); f.created.push({ title, body, labels }); return 10 + f.created.length; },
      cards: async () => f.cards,
      pullRequestFor: async () => null,
      reopen: async (n: number) => note(`reopen ${n}`),
      issue: async () => ({ number: 7, title: 'T', body: 'Simulate battles', labels: ['adhoc'], createdAt: '', state: 'OPEN', thumbsUp: [] }),
      editIssue: async () => note('editIssue'),
      comment: async (_n: number, body: string) => note(`comment ${body}`),
      move: async (_n: number, column: string) => note(`move ${column}`),
      close: async (_n: number, reason: string) => note(`close ${reason}`),
      removeLabel: async (n: number, label: string) => note(`removeLabel ${n} ${label}`),
      createRelease: async (tag: string, target: string, title: string, notes: string) => note(`release ${tag} ${target} ${title}\n${notes}`),
      addCard: async (_n: number, column: string) => note(`addCard ${column}`),
      openPullRequest: async (branch: string, base: string, title: string, body: string) => { f.prBodies.push(body); note(`pr ${branch} ${base} ${title}`); return 'http://pr'; },
    },
    telegram: {
      sendMessage: async (chat: string, text: string, replyTo?: number) => { note(`message ${chat} ${replyTo ?? '-'} ${text}`); return 1; },
      sendPhoto: async (chat: string, path: string, caption: string, buttons?: InlineButton[][]) => { note(`photo ${chat}`); f.photos.push({ chat, path, caption, buttons }); return 42; },
      sendDocument: async (chat: string, path: string, replyTo?: number) => { note(`document ${chat} ${replyTo ?? '-'} ${path}`); return 43; },
      sendPhotos: async (chat: string, photos: { path: string; caption: string }[], replyTo?: number) => {
        note(`album ${chat} ${photos.length} ${replyTo ?? '-'}`);
        if (f.albumFails) throw new Error('Telegram sendMediaGroup failed: boom');
        f.albums.push({ chat, paths: photos.map((p) => p.path), captions: photos.map((p) => p.caption), replyTo });
        return photos.map((_, i) => 60 + i);
      },
      editCaption: async (_chat: string, id: number, caption: string) => { note(`editCaption ${id} ${caption}`); },
      editText: async (_chat: string, id: number, text: string) => { note(`editText ${id} ${text}`); },
      sendButtons: async (chat: string, text: string, buttons: InlineButton[][]) => { note(`buttons ${chat}`); f.texts.push({ chat, text, buttons }); return 44; },
    },
    container: {
      shell: async () => note('shell'),
      agent: async (run: AgentRun) => {
        f.agentRuns.push(run);
        note(run.readOnly ? `agent ro ${JSON.stringify(run.readOnly)}` : 'agent');
        const home = agentHome(run.clone, run.dir);
        mkdirSync(join(home, '.factory'), { recursive: true });
        for (const [name, text] of Object.entries(f.agentWrites)) {
          mkdirSync(dirname(join(home, '.factory', name)), { recursive: true });
          writeFileSync(join(home, '.factory', name), text, 'latin1');
        }
        return `${JSON.stringify({ type: 'result', total_cost_usd: 1, duration_ms: 1000 })}\n`;
      },
    },
    repo: {
      path: join(ROOT, 'repo'),
      fetch: async () => note('fetch'),
      prepareWorkClone: async (branch: string, _base: string, dir: string) => {
        note(`prepare ${branch}`);
        mkdirSync(join(dir, 'game', 'dist', 'assets'), { recursive: true });
        writeFileSync(join(dir, 'game', 'dist', 'assets', 'index.js.map'), '{}');
      },
      fetchFromWork: async () => { note('fetchFromWork'); return 'work-head'; },
      untrackFactoryFiles: async () => [],
      push: async (commit: string, branch: string) => note(`push ${commit} ${branch}`),
      mergeBranchIntoWork: async () => ({ commit: null, conflicts: [] }),
      merge: async (steps: MergeStep[], resolutions: Resolution[] = []) => {
        for (const step of steps) {
          note(`merge ${step.branch} ${step.into}`);
          const open = f.mergeConflicts.includes(`${step.branch} ${step.into}`) && !resolutions.some((item) => item.base === `${step.into}-tip` && item.source === `${step.branch}-tip`);
          if (open) throw new MergeConflictError(step, ['game/src/a.ts'], 'boom', `${step.into}-tip`, `${step.branch}-tip`);
        }
        note(`push ${steps.map((step) => step.into).join(' ')}`);
      },
      openConflict: async (dir: string, conflict: MergeConflictError | RevertConflictError) => { note(`open ${conflict.into}`); mkdirSync(dir, { recursive: true }); },
      closeConflict: async (_dir: string, conflict: MergeConflictError | RevertConflictError) => {
        note(`close ${conflict.into}`);
        return { resolution: { base: conflict.base, source: conflict instanceof MergeConflictError ? conflict.source : conflict.merge, head: 'resolved-head' }, diff: '' };
      },
      mergeLog: async () => f.changelog,
      diff: async () => f.diff,
      hasNewCommits: async () => true,
      isMerged: async () => true,
      headHash: async () => 'abc1234',
      createBranch: async (name: string, from: string) => note(`branch ${name} ${from}`),
      revertIssueMerge: async (issue: number, branch: string, resolutions: Resolution[] = []) => {
        note(`revert ${issue} ${branch}`);
        if (f.revertConflicts.includes(branch) && !resolutions.some((item) => item.base === `${branch}-tip`)) throw new RevertConflictError(issue, branch, ['game/src/a.ts'], 'boom', `${branch}-tip`, 'merge-hash');
        return true;
      },
      deleteBranch: async (branch: string) => note(`delete ${branch}`),
    },
  } as unknown as Ctx;
  return f;
}

export function reset(): void {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, 'repo', 'game'), { recursive: true });
  writeFileSync(join(ROOT, 'code.env'), '');
  writeState(join(ROOT, 'state.json'), structuredClone(EMPTY_STATE));
}

