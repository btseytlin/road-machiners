import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readState, updateState } from '../state';
import { fillPrompt } from './common';
import { adhoc } from './adhoc';
import { cfg, fake, reset, type Fake } from './test-fakes';

beforeEach(reset);

function queueReply(statePath: string): void {
  updateState(statePath, (state) => ({ ...state, adhocReplies: { '7': { chat: '-5', messageId: 3 } } }));
}

describe('adhoc', () => {
  it('posts the report as a reply, closes the issue and drops the reply entry', async () => {
    const f = fake();
    queueReply(f.ctx.statePath);
    f.agentWrites = { 'report.md': 'The MG is fine.\n' };
    await adhoc(f.ctx, 7);
    expect(f.calls).toContain('message -5 3 The MG is fine.');
    expect(f.calls).toContain('comment The MG is fine.');
    expect(f.calls).toContain('close completed');
    expect(f.calls).toContain('move Done');
    expect(f.calls.some((call) => call.startsWith('push'))).toBe(false);
    expect(readState(f.ctx.statePath).adhocReplies).toEqual({});
    expect(existsSync(`${cfg.home}/work/adhoc-7`)).toBe(false);
  });

  it('gives the agent the state, logs, ledger and transcripts read only, made first on a fresh host', async () => {
    const f = fake();
    queueReply(f.ctx.statePath);
    f.agentWrites = { 'report.md': 'x' };
    await adhoc(f.ctx, 7);
    const readOnly = { [dirname(f.ctx.statePath)]: '/factory/state', [`${cfg.home}/logs`]: '/factory/logs', [`${cfg.home}/ledger.jsonl`]: '/factory/ledger.jsonl', [`${cfg.home}/transcripts`]: '/factory/transcripts' };
    expect(f.calls).toContain(`agent ro ${JSON.stringify(readOnly)}`);
    expect([statSync(`${cfg.home}/ledger.jsonl`).isFile(), statSync(`${cfg.home}/transcripts`).isDirectory()]).toEqual([true, true]);
  });

  it('sends each file the agent made under the report message', async () => {
    const f = fake();
    queueReply(f.ctx.statePath);
    f.agentWrites = { 'report.md': 'Tokens go to design.', 'files/report.html': '<html></html>', 'files/chart.png': 'png' };
    await adhoc(f.ctx, 7);
    const files = `${cfg.home}/adhoc-artifacts/issue-7`;
    const message = f.calls.indexOf('message -5 3 Tokens go to design.');
    expect(f.calls.slice(message + 1, message + 3)).toEqual([`document -5 1 ${files}/chart.png`, `document -5 1 ${files}/report.html`]);
    expect(existsSync(files)).toBe(false);
  });

  it('sends no file when the agent made none', async () => {
    const f = fake();
    queueReply(f.ctx.statePath);
    f.agentWrites = { 'report.md': 'x' };
    await adhoc(f.ctx, 7);
    expect(f.calls.some((call) => call.startsWith('document'))).toBe(false);
  });

  it('throws when the agent wrote no report', async () => {
    const f = fake();
    queueReply(f.ctx.statePath);
    await expect(adhoc(f.ctx, 7)).rejects.toThrow('report.md');
    expect(f.calls.some((call) => call.startsWith('close'))).toBe(false);
  });

  it('throws when no chat message is recorded', async () => {
    const f = fake();
    f.agentWrites = { 'report.md': 'x' };
    await expect(adhoc(f.ctx, 7)).rejects.toThrow('No chat message');
  });

  describe('artifact delivery', () => {
    const filesDir = `${cfg.home}/work/adhoc-7/game/.factory/files`;
    const documents = (f: Fake) => f.calls.filter((call) => call.startsWith('document'));

    // The fake agent writes text only, so a test that needs a link or a big file adds it after the agent ran.
    function afterAgent(f: Fake, extra: (dir: string) => void): void {
      const agent = f.ctx.container.agent;
      f.ctx.container.agent = async (run) => {
        await agent(run);
        mkdirSync(filesDir, { recursive: true });
        extra(filesDir);
        return '';
      };
    }

    function expectRefused(f: Fake, reason: RegExp): void {
      expect(documents(f)).toEqual([]);
      expect(f.calls.some((call) => call.startsWith('message -5 3 The report'))).toBe(false);
      expect(f.calls.some((call) => call.startsWith('comment') || call.startsWith('close'))).toBe(false);
      expect(f.calls.some((call) => reason.test(call) && call.startsWith('message -5 3 The task made a file'))).toBe(true);
      expect(existsSync(`${cfg.home}/adhoc-artifacts/issue-7`)).toBe(false);
    }

    it('sends an HTML report as a document reply under the report and keeps its contents out of chat and GitHub', async () => {
      const f = fake();
      queueReply(f.ctx.statePath);
      f.agentWrites = { 'report.md': 'The report is attached.', 'files/analytics.html': '<html>SECRET-ROWS</html>' };
      await adhoc(f.ctx, 7);
      expect(documents(f)).toEqual([`document -5 1 ${cfg.home}/adhoc-artifacts/issue-7/analytics.html`]);
      expect(f.calls.filter((call) => call.includes('SECRET-ROWS'))).toEqual([]);
      expect(f.calls.filter((call) => call.startsWith('comment'))).toEqual(['comment The report is attached.']);
    });

    it('delivers the held file with its own name and bytes', async () => {
      const f = fake();
      queueReply(f.ctx.statePath);
      f.agentWrites = { 'report.md': 'ok', 'files/analytics.html': '<html>x</html>' };
      let seen = '';
      f.ctx.telegram.sendDocument = async (_chat, path) => { seen = readFileSync(path, 'utf8'); return 5; };
      await adhoc(f.ctx, 7);
      expect(seen).toBe('<html>x</html>');
    });

    it('refuses a disallowed extension', async () => {
      const f = fake();
      queueReply(f.ctx.statePath);
      f.agentWrites = { 'report.md': 'The report.', 'files/run.sh': 'rm -rf /' };
      await expect(adhoc(f.ctx, 7)).rejects.toThrow('extension');
      expectRefused(f, /run\.sh/);
    });

    it('refuses an empty file', async () => {
      const f = fake();
      queueReply(f.ctx.statePath);
      f.agentWrites = { 'report.md': 'The report.', 'files/a.csv': '' };
      await expect(adhoc(f.ctx, 7)).rejects.toThrow('empty');
      expectRefused(f, /empty/);
    });

    it('refuses a file over the Telegram limit', async () => {
      const f = fake();
      queueReply(f.ctx.statePath);
      f.agentWrites = { 'report.md': 'The report.' };
      afterAgent(f, (dir) => { writeFileSync(`${dir}/big.zip`, 'x'); truncateSync(`${dir}/big.zip`, 50 * 1024 * 1024 + 1); });
      await expect(adhoc(f.ctx, 7)).rejects.toThrow('Telegram takes at most');
      expectRefused(f, /big\.zip/);
    });

    it('refuses a symlink to a file outside the clone', async () => {
      const f = fake();
      queueReply(f.ctx.statePath);
      f.agentWrites = { 'report.md': 'The report.' };
      afterAgent(f, (dir) => symlinkSync('/etc/passwd', `${dir}/passwd.txt`));
      await expect(adhoc(f.ctx, 7)).rejects.toThrow('not a regular file');
      expectRefused(f, /passwd\.txt/);
    });

    it('refuses a files folder that is a link out of the clone', async () => {
      const f = fake();
      queueReply(f.ctx.statePath);
      f.agentWrites = { 'report.md': 'The report.' };
      const agent = f.ctx.container.agent;
      f.ctx.container.agent = async (run) => {
        await agent(run);
        symlinkSync('/etc', `${cfg.home}/work/adhoc-7/game/.factory/files`);
        return '';
      };
      await expect(adhoc(f.ctx, 7)).rejects.toThrow('not a plain folder');
      expect(documents(f)).toEqual([]);
    });

    it('refuses a nested folder and a name with path traversal', async () => {
      const f = fake();
      queueReply(f.ctx.statePath);
      f.agentWrites = { 'report.md': 'The report.', 'files/sub/a.csv': 'a,b' };
      await expect(adhoc(f.ctx, 7)).rejects.toThrow('not a regular file');
      const g = fake();
      queueReply(g.ctx.statePath);
      g.agentWrites = { 'report.md': 'The report.' };
      afterAgent(g, (dir) => writeFileSync(`${dir}/..hidden.csv`, 'a'));
      await expect(adhoc(g.ctx, 7)).rejects.toThrow('not allowed');
      expect(documents(g)).toEqual([]);
    });

    it('refuses too many files', async () => {
      const f = fake();
      queueReply(f.ctx.statePath);
      f.agentWrites = { 'report.md': 'The report.', ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`files/f${i}.csv`, 'a'])) };
      await expect(adhoc(f.ctx, 7)).rejects.toThrow('limit is 10');
      expect(documents(f)).toEqual([]);
    });

    it('fails visibly when the upload fails, keeps the file privately and sends no link', async () => {
      const f = fake();
      queueReply(f.ctx.statePath);
      f.agentWrites = { 'report.md': 'The report.', 'files/analytics.html': '<html></html>' };
      f.ctx.telegram.sendDocument = async () => { throw new Error('Telegram sendDocument failed: Bad Request'); };
      await expect(adhoc(f.ctx, 7)).rejects.toThrow('Bad Request');
      expect(f.calls.some((call) => call.startsWith('message -5 3 Could not send the file analytics.html'))).toBe(true);
      expect(f.calls.some((call) => /https?:\/\//.test(call))).toBe(false);
      expect(readFileSync(`${cfg.home}/adhoc-artifacts/issue-7/analytics.html`, 'utf8')).toBe('<html></html>');
      expect(f.calls.some((call) => call.startsWith('close'))).toBe(false);
      expect(readState(f.ctx.statePath).adhocReplies['7']).toBeDefined();
    });

    it('never writes to the web root, even when the request asks to publish on the web', async () => {
      const f = fake();
      queueReply(f.ctx.statePath);
      f.ctx.github.issue = async () => ({ number: 7, title: 'T', body: 'Make an HTML report and publish it at a public web URL under /opt/factory/www/reports', labels: ['adhoc'], createdAt: '', state: 'OPEN', thumbsUp: [], author: 'a' });
      f.agentWrites = { 'report.md': 'The report comes as a file.', 'files/analytics.html': '<html></html>' };
      await adhoc(f.ctx, 7);
      expect(documents(f)).toHaveLength(1);
      expect(f.calls.filter((call) => call.startsWith('run'))).toEqual([]);
      expect(existsSync(`${cfg.home}/www`)).toBe(false);
    });

    it('tells the agent to refuse publication and to send files only as documents', () => {
      const prompt = fillPrompt('adhoc', { issue: '7', state: '/s', logs: '/l', ledger: '/g', transcripts: '/t', transcriptDays: '10', files: '.factory/files', playtest: 'npm run playtest' });
      expect(prompt).toMatch(/never publish an artifact/i);
      expect(prompt).toMatch(/refuse that part/);
      expect(prompt).toContain('/opt/factory/www');
      expect(prompt).toMatch(/never paste a file's contents/i);
      expect(prompt).not.toMatch(/publish (it|the file) (to|at|under)/i);
    });
  });
});
