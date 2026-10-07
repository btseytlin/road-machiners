import { describe, expect, it } from 'vitest';
import { buildBadge } from './badges';
import type { Snapshot } from './snapshot';

function card(issue: number, column: string) {
  return { issue, title: `Card ${issue}`, column, blocked: false, releaseTask: false };
}
function snapshotWith(options: { github?: boolean } = {}): Snapshot {
  const github = options.github === false ? null : {
    cards: [card(1, 'Triage'), card(2, 'Design'), card(3, 'Implementation'), card(4, 'Hardening'), card(5, 'Approval')],
    features: [{ issue: 2, title: 'A' }, { issue: 3, title: 'B' }, { issue: 4, title: 'C' }],
    releaseKey: '{}', provisional: false,
  };
  return { github: { value: github, at: null, status: github === null ? 'unavailable' : 'ok' } } as unknown as Snapshot;
}

describe('README badges', () => {
  it('counts the next release features and the open cards past triage', () => {
    expect(buildBadge('release', snapshotWith())).toMatchObject({ schemaVersion: 1, label: 'next release', message: '3 features' });
    expect(buildBadge('building', snapshotWith())).toMatchObject({ label: 'building', message: '4 features' });
  });
  it('marks a badge as an error when its data is missing, and knows no other names', () => {
    expect(buildBadge('release', snapshotWith({ github: false }))).toMatchObject({ message: 'unavailable', isError: true });
    expect(buildBadge('snapshot', snapshotWith())).toBeNull();
  });
});
