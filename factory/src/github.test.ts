import { describe, expect, it } from 'vitest';
import { ghClient } from './github';
import type { FactoryConfig, Run, RunResult } from './types';

const CFG = { repo: 'o/r', projectOwner: 'o', projectNumber: 3, githubRetries: 3, githubRetryBaseSeconds: 15, githubTimeoutSeconds: 60 } as FactoryConfig;
const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });
const RATE_LIMITED: RunResult = { code: 1, stdout: '', stderr: 'HTTP 403: API rate limit exceeded for user ID 1.' };

const NODE = (number: number, voters: string[] = []) => ({
  number, title: `t${number}`, body: '', labels: { nodes: [{ name: 'bug' }] }, createdAt: '2026-01-01T00:00:00Z', state: 'OPEN', author: { login: 'anna' },
  reactions: { pageInfo: { hasNextPage: false }, nodes: voters.map((login) => ({ user: { login } })) },
});

function searchPage(nodes: unknown[], endCursor = ''): string {
  return JSON.stringify({ data: { search: { pageInfo: { hasNextPage: endCursor !== '', endCursor }, nodes } } });
}

function project(options: string[]): string {
  const field = { id: 'F1', options: options.map((name) => ({ id: `id-${name}`, name })) };
  return JSON.stringify({ data: { user: { projectV2: { id: 'P1', field } } } });
}

const ALL = ['Triage', 'Design', 'Implementation', 'Testing', 'Approval', 'Hardening', 'Done'];

function fake(calls: string[][], projectJson: string): Run {
  return async (_cmd, args) => {
    calls.push(args);
    const text = args.join(' ');
    if (text.includes('search(type: ISSUE')) return ok(text.includes('cursor=') ? searchPage([NODE(3)]) : searchPage([NODE(1, ['anna', 'boss']), NODE(2)], 'C1'));
    if (text.includes('repos/o/r/issues/1/comments')) return ok('{"login":"a","body":"hi\\nthere"}\n');
    if (text.includes('projectV2(number')) return ok(projectJson);
    if (text.includes('items(first')) {
      const items = { pageInfo: { hasNextPage: false, endCursor: '' }, nodes: [
        { id: 'I7', fieldValueByName: { name: 'Design' }, content: { number: 7, repository: { nameWithOwner: 'o/r' }, labels: { nodes: [{ name: 'bug' }] } } },
        { id: 'I8', fieldValueByName: { name: 'Done' }, content: { number: 8, repository: { nameWithOwner: 'x/y' }, labels: { nodes: [] } } },
        { id: 'I9', fieldValueByName: null, content: { number: 9, repository: { nameWithOwner: 'o/r' }, labels: { nodes: [] } } },
      ] };
      return ok(JSON.stringify({ data: { node: { items } } }));
    }
    return ok('');
  };
}

describe('ghClient', () => {
  it('reads candidates of any label with their thumbs-up in one search, page by page', async () => {
    const calls: string[][] = [];
    const found = await ghClient(fake(calls, project(ALL)), CFG).candidates(['bug', 'feature-request']);
    expect(found.map((i) => i.number)).toEqual([1, 2, 3]);
    expect(found[0]).toMatchObject({ author: 'anna', labels: ['bug'], state: 'OPEN', thumbsUp: ['anna', 'boss'] });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('search=repo:o/r is:issue is:open label:"bug","feature-request"');
    expect(calls[1]).toContain('cursor=C1');
  });

  it('stops intake when an issue has more thumbs-up than one search reads', async () => {
    const node = { ...NODE(1), reactions: { pageInfo: { hasNextPage: true }, nodes: [] } };
    const client = ghClient(async () => ok(searchPage([node])), CFG);
    await expect(client.candidates(['bug'])).rejects.toThrow('over 100 thumbs-up');
  });

  it('waits twice as long before each retry of a rate-limited call', async () => {
    const waits: number[] = [];
    let calls = 0;
    const run: Run = async () => (++calls < 4 ? RATE_LIMITED : ok(''));
    await ghClient(run, CFG, async (ms) => { waits.push(ms); }).reopen(7);
    expect(waits).toEqual([15000, 30000, 60000]);
  });

  it('fails with the rate-limit error once the retries run out', async () => {
    const waits: number[] = [];
    const client = ghClient(async () => RATE_LIMITED, CFG, async (ms) => { waits.push(ms); });
    await expect(client.reopen(7)).rejects.toThrow('rate limit');
    expect(waits).toHaveLength(3);
  });

  it('does not retry a failure that is not a rate limit', async () => {
    let calls = 0;
    const run: Run = async () => { calls++; return { code: 1, stdout: '', stderr: 'HTTP 404: Not Found' }; };
    await expect(ghClient(run, CFG, async () => {}).reopen(7)).rejects.toThrow('404');
    expect(calls).toBe(1);
  });

  it('gives every call the timeout and does not retry a call that timed out', async () => {
    const timeouts: (number | undefined)[] = [];
    const run: Run = async (_cmd, _args, opts) => { timeouts.push(opts?.timeoutMs); return { code: 1, stdout: '', stderr: 'gh timed out after 60000 ms and was killed' }; };
    await expect(ghClient(run, CFG, async () => {}).reopen(7)).rejects.toThrow('timed out');
    expect(timeouts).toEqual([60000]);
  });

  it('sends one call at a time, even after a failed call', async () => {
    let running = 0;
    let most = 0;
    const run: Run = async (_cmd, args) => {
      running++;
      most = Math.max(most, running);
      await new Promise((done) => setTimeout(done, 5));
      running--;
      return args.includes('1') ? { code: 1, stdout: '', stderr: 'HTTP 404' } : ok('');
    };
    const client = ghClient(run, CFG);
    const results = await Promise.allSettled([client.reopen(1), client.reopen(2), client.reopen(3)]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
    expect(most).toBe(1);
  });

  it('ends every comment with the factory marker on its own line', async () => {
    const calls: string[][] = [];
    await ghClient(fake(calls, project(ALL)), CFG).comment(1, 'Hello');
    expect(calls[0]).toEqual(['issue', 'comment', '1', '-R', 'o/r', '--body', 'Hello\n\n<!-- roam-factory -->']);
  });

  it('reads comments', async () => {
    const list = await ghClient(fake([], project(ALL)), CFG).comments(1);
    expect(list).toEqual([{ login: 'a', body: 'hi\nthere' }]);
  });

  it('lists cards of this repo with a status', async () => {
    const cards = await ghClient(fake([], project(ALL)), CFG).cards();
    expect(cards).toEqual([{ itemId: 'I7', issue: 7, column: 'Design', labels: ['bug'] }]);
  });

  it('move sets the status option of the item', async () => {
    const calls: string[][] = [];
    await ghClient(fake(calls, project(ALL)), CFG).move(7, 'Testing');
    const mutation = calls.find((args) => args.join(' ').includes('updateProjectV2ItemFieldValue')) ?? [];
    expect(mutation).toEqual(expect.arrayContaining(['project=P1', 'item=I7', 'field=F1', 'option=id-Testing']));
  });

  it('finds the open pull request of a branch or null', async () => {
    const run: Run = async (_cmd, args) => ok(args.includes('factory/issue-7') ? '[{"url":"https://github.com/o/r/pull/3"}]' : '[]');
    const client = ghClient(run, CFG);
    expect(await client.pullRequestFor('factory/issue-7')).toBe('https://github.com/o/r/pull/3');
    expect(await client.pullRequestFor('factory/issue-8')).toBeNull();
  });

  it('lists pull requests by head and closes one with a comment', async () => {
    const calls: string[][] = [];
    const client = ghClient(async (_cmd, args) => { calls.push(args); return ok('[]'); }, CFG);
    await client.pullRequestFor('b');
    await client.closePullRequest('b', 'Denied');
    expect(calls[0]).toEqual(['pr', 'list', '-R', 'o/r', '--head', 'b', '--state', 'open', '--json', 'url']);
    expect(calls[1]).toEqual(['pr', 'close', 'b', '-R', 'o/r', '--comment', 'Denied']);
  });

  it('names a missing Status option', async () => {
    const client = ghClient(fake([], project(['Triage', 'Design', 'Done'])), CFG);
    await expect(client.cards()).rejects.toThrow('"Implementation"');
  });

  it('shows the real error when the project lookup fails for another reason', async () => {
    const run: Run = async () => ({ code: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' });
    await expect(ghClient(run, CFG).cards()).rejects.toThrow('502');
  });

  it('tries the organization when the owner is not a user', async () => {
    const orgProject = JSON.stringify({ data: { organization: { projectV2: { id: 'P1', field: { id: 'F1', options: ALL.map((name) => ({ id: name, name })) } } } } });
    const run: Run = async (_cmd, args) => {
      const text = args.join(' ');
      if (text.includes('user(login')) return { code: 1, stdout: '', stderr: "Could not resolve to a User with the login of 'o'." };
      if (text.includes('organization(login')) return ok(orgProject);
      return ok(JSON.stringify({ data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: '' }, nodes: [] } } } }));
    };
    await expect(ghClient(run, CFG).cards()).resolves.toEqual([]);
  });

  it('reopens an issue', async () => {
    const calls: string[][] = [];
    await ghClient(async (_cmd, args) => { calls.push(args); return ok(''); }, CFG).reopen(7);
    expect(calls).toEqual([['issue', 'reopen', '7', '-R', 'o/r']]);
  });

  it('creates a missing label before it opens an issue with it', async () => {
    const calls: string[][] = [];
    const run: Run = async (_cmd, args) => { calls.push(args); return ok(args[0] === 'issue' ? 'https://github.com/o/r/issues/31\n' : ''); };
    const number = await ghClient(run, CFG).createIssue('T', 'B', ['release-task', 'maintenance']);
    expect(number).toBe(31);
    expect(calls.map((args) => args.slice(0, 3).join(' '))).toEqual(['label create release-task', 'label create maintenance', 'issue create -R']);
    expect(calls[2]).toEqual(['issue', 'create', '-R', 'o/r', '--title', 'T', '--body', 'B', '--label', 'release-task', '--label', 'maintenance']);
  });

  it('finds the oldest error-report issue whose body holds the exact fingerprint line, open or closed', async () => {
    const calls: string[][] = [];
    const found = [
      { number: 9, state: 'OPEN', stateReason: '', closedAt: '', body: 'mentions 0123456789abcdef in a comment' },
      { number: 7, state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-10-03T00:00:00Z', body: 'x\nError fingerprint: 0123456789abcdef' },
      { number: 8, state: 'OPEN', stateReason: '', closedAt: '', body: 'Error fingerprint: 0123456789abcdef' },
    ];
    const run: Run = async (_cmd, args) => { calls.push(args); return ok(JSON.stringify(found)); };
    const client = ghClient(run, CFG);
    expect(await client.findByFingerprint('0123456789abcdef')).toEqual({ number: 7, state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-10-03T00:00:00Z' });
    expect(calls[0]).toEqual(['issue', 'list', '-R', 'o/r', '--state', 'all', '--label', 'error-report', '--search', '"0123456789abcdef" in:body', '--json', 'number,state,stateReason,closedAt,body']);
    const none: Run = async () => ok(JSON.stringify([found[0]]));
    expect(await ghClient(none, CFG).findByFingerprint('0123456789abcdef')).toBeNull();
  });

  it('reads an open error-report issue with empty close fields as null', async () => {
    const run: Run = async () => ok(JSON.stringify({ number: 8, state: 'OPEN', stateReason: '', closedAt: '' }));
    expect(await ghClient(run, CFG).errorIssue(8)).toEqual({ number: 8, state: 'OPEN', stateReason: null, closedAt: null });
  });
});
