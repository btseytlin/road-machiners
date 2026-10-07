import { expect, it } from 'vitest';
import { PublicGitHub } from './snapshot';
import { EMPTY_STATE } from '../state';
import type { DashboardConfig } from './config';
import type { Run } from '../types';

it('pins both comparison refs and fetches only public issue data through read calls', async () => {
  const head = 'a'.repeat(40);
  const base = 'b'.repeat(40);
  const calls: string[][] = [];
  const columns = ['Triage', 'Design', 'Implementation', 'Testing', 'Approval', 'Hardening', 'Done'];
  const run: Run = async (_cmd, args) => {
    calls.push(args);
    const endpoint = args[1];
    let data: unknown;
    if (endpoint === 'repos/owner/game') return { code: 0, stdout: 'public', stderr: '' };
    if (endpoint.startsWith('repos/owner/game/commits/')) return { code: 0, stdout: endpoint.endsWith('/main') ? base : head, stderr: '' };
    if (endpoint.includes('/compare/')) {
      expect(args).toContain('--paginate');
      expect(args).not.toContain('--slurp');
      expect(args.slice(args.indexOf('--jq') + 1)[0]).toContain('total_commits');
      return { code: 0, stdout: [
        { total_commits: 2, commits: [{ sha: 'c'.repeat(40), parents: [{ sha: base }], commit: { message: 'Ordinary commit' } }] },
        { total_commits: 2, commits: [{ sha: head, parents: [{ sha: 'c'.repeat(40) }, { sha: 'side' }], commit: { message: 'Merge issue #7: Public feature' } }] },
      ].map((page) => JSON.stringify(page)).join('\n'), stderr: '' };
    }
    if (endpoint.includes('/issues?')) return { code: 0, stdout: [
      { number: 7, title: 'Public feature', labels: [] }, { number: 8, title: 'PRIVATE ad hoc request', labels: [{ name: 'adhoc' }] },
    ].map((row) => JSON.stringify(row)).join('\n'), stderr: '' };
    if (endpoint === 'graphql') {
      const query = args.find((arg) => arg.startsWith('query='))!;
      expect(query).not.toContain('mutation');
      data = query.includes('items(first:') ? { data: { node: { items: { pageInfo: { hasNextPage: false }, nodes: [7, 8].map((number) => ({ id: String(number), fieldValueByName: { name: 'Testing' }, content: { number, repository: { nameWithOwner: 'owner/game' }, labels: { nodes: [] } } })) } } } } : { data: { user: { projectV2: { id: 'P', field: { id: 'S', options: columns.map((name) => ({ id: name, name })) } } } } };
    }
    if (data === undefined) throw new Error(`Unexpected read: ${args.join(' ')}`);
    return { code: 0, stdout: JSON.stringify(data), stderr: '' };
  };
  const config = { repo: 'owner/game', projectOwner: 'owner', projectNumber: 1 } as DashboardConfig;
  const result = await new PublicGitHub(config, run).read(structuredClone(EMPTY_STATE));
  expect(result.features).toEqual([{ issue: 7, title: 'Public feature' }]);
  expect(result.cards.map((card) => card.issue)).toEqual([7]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(calls.some((args) => args[1] === `repos/owner/game/compare/${base}...${head}?per_page=100`)).toBe(true);
});
