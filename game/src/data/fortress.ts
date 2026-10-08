// Fortress sites: the inhabited sites, walled by baked wall, tower, gatehouse, bastion and inner gate pieces.
// Lengths are in tiles of 4 m. The piece models are built to these sizes: walls 3 tiles high, and towers,
// bastions and gatehouses at least 3 tiles high, so each stands over 3x the tallest truck.

export type FortressShape = 'circle' | 'square' | 'star' | 'bastioned';
export type FortressStyle = 'masonry' | 'shipMetal' | 'scrap' | 'patchwork' | 'compound' | 'ring' | 'yard';
export type FortressKind = 'wall' | 'tower' | 'gate' | 'bastion' | 'inner';
export type FortressBastions = { capitals: readonly number[]; curtain: number; salient: number; gorge: number; flank: number };
export type FortressPit = { margin: number; terraceWidth: number; stepHeight: number; terraces: number };
export type FortressRock = { from: number; to: number };
export type FortressSite = { shape: FortressShape; turn: number; style: FortressStyle; bastions?: FortressBastions; towers?: boolean; towerEvery?: number; pit?: FortressPit; rock?: readonly FortressRock[] };

export type FortressGate = { width: number; depth: number; height: number };
export type FortressStyleDef = { flush: boolean; gate: FortressGate; gateFlare: number; pieces: readonly FortressKind[] };

export const FORTRESS_SITES: Record<string, FortressSite> = {
  bowl: {
    shape: 'bastioned',
    turn: 0,
    style: 'patchwork',
    bastions: { capitals: [-85.34, -44.52, -3.7, 60, 128, 198], curtain: 21.5, salient: 26.75, gorge: 2.5, flank: 2.5 },
    pit: { margin: 1, terraceWidth: 1.8, stepHeight: 0.5, terraces: 4 },
  },
  nose: { shape: 'circle', turn: 8, style: 'shipMetal', towerEvery: 3, rock: [{ from: 228, to: 352 }] },
  dustwell: { shape: 'square', turn: 45, style: 'compound' },
  'green-pit': { shape: 'circle', turn: 8, style: 'masonry' },
  'pump-station': { shape: 'square', turn: 0, style: 'masonry' },
  granary: { shape: 'circle', turn: 36, style: 'ring', towers: false },
  'salvage-yard': { shape: 'square', turn: 45, style: 'yard' },
  'south-lock': { shape: 'star', turn: 4, style: 'masonry' },
  scrapjaw: { shape: 'circle', turn: -10, style: 'scrap' },
  kiln: { shape: 'square', turn: 93, style: 'scrap' },
};

export const NOSE_APRON = { height: 1.25, run: 10, clear: 4, ramp: 4 };

export const FORTRESS = {
  inset: 1.25,
  wallLength: 2,
  wallDepth: 0.75,
  stretch: [0.6, 1.6] as [number, number],
  towerSize: 1.5,
  bastionBack: 0.4,
  bastionSize: 1.5,
  gate: { width: 5, depth: 2.5, height: 4 } as FortressGate,
  innerWidth: 3,
  circleTowerEvery: 5,
  flankMin: 2,
  starPoints: 5,
  starDepth: 0.4,
  gateClearance: 1,
};

const CASTLE: FortressStyleDef = { flush: false, gate: FORTRESS.gate, gateFlare: 0.08, pieces: ['wall', 'tower', 'gate', 'bastion', 'inner'] };

export const FORTRESS_STYLES: Record<FortressStyle, FortressStyleDef> = {
  masonry: CASTLE,
  scrap: CASTLE,
  patchwork: { flush: true, gate: { width: 3, depth: 1.25, height: 3 }, gateFlare: 0, pieces: ['wall', 'tower', 'gate'] },
  compound: { flush: true, gate: { width: 2, depth: 1, height: 3 }, gateFlare: 0, pieces: ['wall', 'tower', 'gate'] },
  ring: { flush: true, gate: { width: 2, depth: 1, height: 3 }, gateFlare: 0, pieces: ['wall', 'gate'] },
  yard: { flush: true, gate: { width: 2.5, depth: 1, height: 3 }, gateFlare: 0, pieces: ['wall', 'tower', 'gate'] },
  shipMetal: { flush: true, gate: { width: 6, depth: 1.5, height: 4.5 }, gateFlare: 0, pieces: ['wall', 'tower', 'gate'] },
};
