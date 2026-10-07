// A run log like the game's progression:playthrough writes, for the playtest tests.
export const WANT = { seed: 20261007, turns: 100, sha: 'abc1234' };
const SUMMARY = { k: 'summary', turns: 100, shots: 4, destroyed: 0, knockouts: 1, deaths: 0, stalls: 0, moneyIn: 50, moneyOut: 20, npcGoals: { trade: 3 }, playerTiles: 80 };

export function logText(over: { header?: object; end?: object; summary?: object } = {}, want = WANT): string {
  const lines = [
    { k: 'run', seed: want.seed, turns: want.turns, sha: want.sha, archetype: 'mixed', every: 50, limits: [], ...over.header },
    { k: 'event', turn: 2, e: { t: 'spawn', vehicle: 'v1' } },
    { k: 'snapshot', turn: 51, player: {}, npcs: [] },
    { k: 'end', turn: 101, reason: 'complete', message: null, ...over.end },
    { ...SUMMARY, ...over.summary },
  ];
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

