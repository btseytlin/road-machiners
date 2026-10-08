import { expect, it } from 'vitest';
import { PublicGitHub } from './snapshot';
import { EMPTY_STATE } from '../state';
import type { DashboardConfig } from './config';
import { COLUMNS, type Run } from '../types';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const config = { repo: 'owner/game', projectOwner: 'owner', projectNumber: 1 } as DashboardConfig;
type MergedRow = { number: number; createdAt: string; labels: string[]; mergedAt: string | null };

function createRun(merges: MergedRow[], calls: string[][]): Run {
  const columns = [...COLUMNS];
  return async (_cmd, args) => {
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
      if (query.includes('labels:["release-candidate"]')) {
        expect(args).toContain('--paginate');
        expect(args).toContain('owner=owner');
        expect(args).toContain('name=game');
        return { code: 0, stdout: merges.map((row) => JSON.stringify(row)).join('\n'), stderr: '' };
      }
      data = query.includes('items(first:') ? { data: { node: { items: { pageInfo: { hasNextPage: false }, nodes: [7, 8].map((number) => ({ id: String(number), fieldValueByName: { name: 'Testing' }, content: { number, repository: { nameWithOwner: 'owner/game' }, labels: { nodes: [] } } })) } } } } : { data: { user: { projectV2: { id: 'P', field: { id: 'S', options: columns.map((name) => ({ id: name, name })) } } } } };
    }
    if (data === undefined) throw new Error(`Unexpected read: ${args.join(' ')}`);
    return { code: 0, stdout: JSON.stringify(data), stderr: '' };
  };
}

const merged = (number: number, labels: string[], mergedAt: string | null): MergedRow => ({ number, createdAt: '2026-10-01T00:00:00Z', labels, mergedAt });

it('pins both comparison refs and fetches only public issue data through read calls', async () => {
  const calls: string[][] = [];
  const run = createRun([], calls);
  const result = await new PublicGitHub(config, run).read(structuredClone(EMPTY_STATE));
  expect(result.features).toEqual([{ issue: 7, title: 'Public feature' }]);
  expect(result.cards.map((card) => card.issue)).toEqual([7]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(calls.some((args) => args[1] === `repos/owner/game/compare/${base}...${head}?per_page=100`)).toBe(true);
});

it('reads the first release-candidate time of each voted issue and skips issues the factory opens itself', async () => {
  const rows = [
    merged(7, ['feature-request', 'release-candidate'], '2026-10-04T12:00:00Z'),
    merged(9, ['release-task', 'release-candidate'], '2026-10-04T13:00:00Z'),
    merged(10, ['adhoc', 'release-candidate'], '2026-10-04T14:00:00Z'),
  ];
  const result = await new PublicGitHub(config, createRun(rows, [])).read(structuredClone(EMPTY_STATE));
  expect(result.merges).toEqual([{ issue: 7, createdAt: '2026-10-01T00:00:00Z', mergedAt: '2026-10-04T12:00:00Z' }]);
});

it('fails when an issue carries release-candidate but has no label event', async () => {
  const rows = [merged(7, ['release-candidate'], null)];
  await expect(new PublicGitHub(config, createRun(rows, [])).read(structuredClone(EMPTY_STATE))).rejects.toThrow('Issue 7 has release-candidate but no label event');
});
