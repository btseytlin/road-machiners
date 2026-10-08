import type { Snapshot } from './snapshot';

// The shields.io endpoint format. A README pill reads it through https://img.shields.io/endpoint?url=<badge url>.
export type Badge = { schemaVersion: 1; label: string; message: string; color: string; isError?: true };

function unavailable(label: string): Badge {
  return { schemaVersion: 1, label, message: 'unavailable', color: 'lightgrey', isError: true };
}
function releaseBadge(snapshot: Snapshot): Badge {
  const github = snapshot.github.value;
  if (github === null) return unavailable('next release');
  return { schemaVersion: 1, label: 'next release', message: `${github.features.length} features`, color: 'e05d44' };
}
// Active work is every open card past triage. Done cards never reach the public snapshot.
function buildingBadge(snapshot: Snapshot): Badge {
  const github = snapshot.github.value;
  if (github === null) return unavailable('building');
  const active = github.cards.filter((card) => card.column !== 'Triage').length;
  return { schemaVersion: 1, label: 'building', message: `${active} features`, color: 'dfb317' };
}

const BADGES: Record<string, (snapshot: Snapshot) => Badge> = { release: releaseBadge, building: buildingBadge };

export function buildBadge(name: string, snapshot: Snapshot): Badge | null {
  const build = BADGES[name];
  return build ? build(snapshot) : null;
}
