import type { ClaymoreDef, UtilityDef } from './parts';

export const UNPRICED_UTILITIES: Record<string, Omit<UtilityDef, 'value'>> = {
  sprout: {
    id: 'sprout',
    kind: 'utility',
    hp: 25,
    base: 4333,
    tier: 1,
    w: 1,
    h: 1,
    mass: 60,
    armor: 2,
    tall: false,
    reload: 10,
    effect: { type: 'sprout', radius: 5, turns: 6 },
  },
  caltrops: {
    id: 'caltrops',
    kind: 'utility',
    hp: 30,
    base: 2900,
    tier: 1,
    w: 1,
    h: 1,
    mass: 70,
    armor: 3,
    tall: false,
    reload: 10,
    effect: { type: 'caltrops', radius: 1.25, turns: 10, behind: 1 },
  },
  oilSpiller: {
    id: 'oilSpiller',
    kind: 'utility',
    hp: 30,
    base: 3933,
    tier: 1,
    w: 1,
    h: 1,
    mass: 90,
    armor: 3,
    tall: false,
    reload: 6,
    effect: { type: 'oil', turns: 8, behind: 1, fuel: 2 },
  },
  patcherCrane: {
    id: 'patcherCrane',
    kind: 'utility',
    hp: 50,
    base: 6000,
    tier: 1,
    w: 1,
    h: 2,
    mass: 150,
    armor: 4,
    tall: false,
    reload: null,
    effect: { type: 'crane' },
  },
  smokeMortar: {
    id: 'smokeMortar',
    kind: 'utility',
    hp: 36,
    base: 8767,
    tier: 2,
    w: 1,
    h: 2,
    mass: 110,
    armor: 3,
    tall: false,
    reload: 8,
    effect: { type: 'mortar', radius: 4, turns: 5, minRange: 5, maxRange: 16 },
  },
  flareCannon: {
    id: 'flareCannon',
    kind: 'utility',
    hp: 28,
    base: 4733,
    tier: 2,
    w: 1,
    h: 1,
    mass: 50,
    armor: 2,
    tall: false,
    reload: 10,
    effect: { type: 'flare', radius: 10, turns: 6, minRange: 4, maxRange: 24 },
  },
  scrapersKnife: {
    id: 'scrapersKnife',
    kind: 'utility',
    hp: 50,
    base: 9333,
    tier: 2,
    w: 1,
    h: 2,
    mass: 170,
    armor: 4,
    tall: false,
    reload: null,
    effect: { type: 'scraper' },
  },
  emitter: {
    id: 'emitter',
    kind: 'utility',
    hp: 44,
    base: 24267,
    tier: 3,
    w: 2,
    h: 2,
    mass: 200,
    armor: 4,
    tall: false,
    reload: 10,
    effect: { type: 'emitter', radius: 6, turns: 2 },
  },
};

export const SMOKE = {
  spread: 0.1,
};

export const CALTROPS = {
  damage: 8,
};

export const OIL = {
  blobs: 6,
  blobR: 0.9,
  spacing: 0.8,
  grip: 0.12,
  safeSpeed: 4,
  kick: 2.4,
  maxKick: 3.2,
};

export function oilSlickLength(): number {
  return (OIL.blobs - 1) * OIL.spacing + 2 * OIL.blobR;
}

export const HARPOON = {
  stiffness: 30000,
  damping: 12000,
  tearForce: 120000,
  tearDamage: 12,
};

export const EMITTER = {
  startsAfter: 1,
};

export const FLARE = {
  seenRange: 80,
};

export const CLAYMORE: ClaymoreDef = {
  minImpact: 3,
  blast: { damage: 60, pen: 12, radius: 2 },
  selfBlast: { damage: 25, pen: 6 },
  throw: { impulse: 40000, lift: 0.35 },
  reload: 20,
};

export const WORK = {
  noCraneTime: 2,
  craneSpeed: 1.5,
  scraperStripShare: 0.65,
};

export const SEARCH = {
  reveal: 0.35,
  scraperReveal: 0.55,
};
