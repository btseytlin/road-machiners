// The one region of the prototype. Coordinates are in tiles.

import type { Vec } from "../sim/vec";

export type TownDef = { id: string; name: string; pos: Vec; radius: number };
export type SiteLocationDef = {
  id: string;
  name: string;
  kind: "oasis" | "convoy" | "landmark" | "camp";
  pos: Vec;
  radius: number;
  edge?: SiteEdge;
  look?: string;
  turn?: number;
  gates?: readonly Vec[];
};
export type TerritoryDef = { id: string; name: string; kind: "territory"; pos: Vec; radius: number; outline: Vec[] | null };
export type LocationDef = SiteLocationDef | TerritoryDef;
export type SiteEdge = "fence" | "wrecks";
export const MAP_SCALE = 5;

export function scalePoint(p: Vec): Vec {
  return { x: p.x * MAP_SCALE, y: p.y * MAP_SCALE };
}

const BEND = {
  step: 6,
  amplitude: 0.07,
  maxSway: 4,
  wavelength: 45,
};

function scaleRoad(points: Vec[], straight: number[] = []): Vec[] {
  const scaled = points.map(scalePoint);
  const out: Vec[] = [scaled[0]];
  for (let i = 1; i < scaled.length; i++) out.push(...(straight.includes(i - 1) ? [scaled[i]] : bend(scaled[i - 1], scaled[i])));
  return out;
}

function bend(a: Vec, b: Vec): Vec[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const count = Math.max(1, Math.round(length / BEND.step));
  const sway = Math.min(BEND.maxSway, length * BEND.amplitude);
  const waves = Math.max(1, Math.round(length / BEND.wavelength));
  const phase = (a.x * 12.9898 + a.y * 78.233 + b.x * 37.719 + b.y * 4.581) % (2 * Math.PI);
  const nx = -(b.y - a.y) / length;
  const ny = (b.x - a.x) / length;
  const points: Vec[] = [];
  for (let k = 1; k <= count; k++) {
    const t = k / count;
    const side = sway * Math.sin(Math.PI * t) * Math.sin(Math.PI * waves * t + phase);
    points.push({ x: a.x + (b.x - a.x) * t + nx * side, y: a.y + (b.y - a.y) * t + ny * side });
  }
  return points;
}

export const FALLEN_SUN_POS = scalePoint({ x: 64, y: 54 });
const FALLEN_SUN_OUTLINE: Vec[] = [
  { x: -45.0, y: 0.0 },
  { x: -41.3, y: -15.0 },
  { x: -31.0, y: -26.0 },
  { x: -20.9, y: -33.5 },
  { x: -11.4, y: -39.9 },
  { x: -6.3, y: -44.6 },
  { x: 1.6, y: -45.0 },
  { x: 7.2, y: -40.9 },
  { x: 15.3, y: -47.1 },
  { x: 27.8, y: -44.5 },
  { x: 37.8, y: -37.8 },
  { x: 45.9, y: -26.5 },
  { x: 50.2, y: -8.9 },
  { x: 50.2, y: 8.9 },
  { x: 45.3, y: 21.1 },
  { x: 39.8, y: 33.4 },
  { x: 25.5, y: 44.2 },
  { x: 8.2, y: 46.3 },
  { x: -2.4, y: 55.3 },
  { x: -8.6, y: 78.4 },
  { x: -13.6, y: 101.9 },
  { x: -22.6, y: 115.1 },
  { x: -30.8, y: 114.9 },
  { x: -38.8, y: 110.9 },
  { x: -38.8, y: 95.4 },
  { x: -31.8, y: 72.2 },
  { x: -25.6, y: 49.1 },
  { x: -23.5, y: 40.7 },
  { x: -37.7, y: 26.4 },
  { x: -43.5, y: 11.6 },
];
const ORCHARD_POS = { x: 114, y: 284 };
const ORCHARD_SCREEN_ANGLE = (25 * Math.PI) / 180;
const ORCHARD_SIN_ELEVATION = 0.5;
export const ORCHARD_HEADING = Math.atan2(
  -Math.cos(ORCHARD_SCREEN_ANGLE) - Math.sin(ORCHARD_SCREEN_ANGLE) / ORCHARD_SIN_ELEVATION,
  Math.cos(ORCHARD_SCREEN_ANGLE) - Math.sin(ORCHARD_SCREEN_ANGLE) / ORCHARD_SIN_ELEVATION,
);

export function onOrchardRoad(s: number, c: number): Vec {
  const [cos, sin] = [Math.cos(ORCHARD_HEADING), Math.sin(ORCHARD_HEADING)];
  return { x: s * cos + c * sin, y: s * sin - c * cos };
}

const ORCHARD_OUTLINE: Vec[] = [
  [-35, 22],
  [-36, 2],
  [-28, -3],
  [-28, -14],
  [-26, -24],
  [-20, -28],
  [0, -31],
  [20, -35.5],
  [40, -39],
  [50, -42],
  [56, -40],
  [58, -12],
  [59, 3],
  [72, 6],
  [72, 42],
  [54, 40],
  [46, 37],
  [40, 34],
  [-30, 34],
].map(([s, c]) => onOrchardRoad(s, c));

function boundingRadius(outline: readonly Vec[]): number {
  return Math.max(...outline.map((p) => Math.hypot(p.x, p.y)));
}

const ORCHARD_SOUTH = onOrchardRoad(-32, 0);

const RIM_REACH = 0.05;
function edgePoint(from: Vec, to: Vec, centre: Vec, outline: readonly Vec[]): Vec {
  const poly = outline.map((p) => ({ x: centre.x + p.x, y: centre.y + p.y }));
  const d = { x: to.x - from.x, y: to.y - from.y };
  const length = Math.hypot(d.x, d.y);
  const ts = poly.flatMap((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const e = { x: b.x - a.x, y: b.y - a.y };
    const den = d.x * e.y - d.y * e.x;
    if (den === 0) return [];
    const t = ((a.x - from.x) * e.y - (a.y - from.y) * e.x) / den;
    const u = ((a.x - from.x) * d.y - (a.y - from.y) * d.x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t] : [];
  });
  if (ts.length === 0) throw new Error("The spur road never reaches the outline");
  const t = Math.min(...ts) + RIM_REACH / length;
  return { x: from.x + d.x * t, y: from.y + d.y * t };
}

export const GLASS_FLATS_POS = scalePoint({ x: 81, y: 75.6 });
const GLASS_FLATS_OUTLINE: Vec[] = [
  [0, 71],
  [11.25, 61],
  [22.5, 56],
  [33.75, 51],
  [45, 47],
  [56.25, 48],
  [67.5, 49],
  [78.75, 55],
  [90, 67],
  [101.25, 76],
  [112.5, 78],
  [123.75, 66],
  [135, 78],
  [146.25, 90],
  [157.5, 80],
  [168.75, 68],
  [180, 60],
  [-168.75, 58],
  [-157.5, 59],
  [-146.25, 60],
  [-135, 58],
  [-123.75, 62],
  [-112.5, 74],
  [-101.25, 86],
  [-90, 95],
  [-78.75, 95],
  [-67.5, 95],
  [-56.25, 95],
  [-45, 95],
  [-33.75, 95],
  [-22.5, 95],
  [-11.25, 83],
].map(([deg, r]) => ({ x: r * Math.cos((deg * Math.PI) / 180), y: r * Math.sin((deg * Math.PI) / 180) }));
const GLASS_FLATS_S1 = scalePoint({ x: 88, y: 84 });
const GLASS_FLATS_S2 = scalePoint({ x: 97, y: 62 });
const GLASS_FLATS_APPROACHES: Vec[][] = [GLASS_FLATS_S1, GLASS_FLATS_S2].map((from) => [from, edgePoint(from, GLASS_FLATS_POS, GLASS_FLATS_POS, GLASS_FLATS_OUTLINE)]);
export const GLASS_FLATS_ENDS: Vec[] = GLASS_FLATS_APPROACHES.map(([, end]) => ({ x: end.x - GLASS_FLATS_POS.x, y: end.y - GLASS_FLATS_POS.y }));

function fromFallenSun(x: number, y: number): Vec {
  return { x: FALLEN_SUN_POS.x + x, y: FALLEN_SUN_POS.y + y };
}

export const BROKEN_WING = {
  road: scalePoint({ x: 70, y: 33 }),
  yaw: 0,
  deckHalf: 19.5,
  mound: { gap: 4.5, flat: 2, bank: 14, height: 1.8 },
  hoopAt: -44,
  siteAt: 44,
  siteSide: 14,
  trench: { side: -22, half: 30, width: 3, bank: 6, depth: 2 },
};

export function BROKEN_WING_POINT(along: number, across: number): Vec {
  const c = Math.cos(BROKEN_WING.yaw);
  const s = Math.sin(BROKEN_WING.yaw);
  return { x: BROKEN_WING.road.x + c * along - s * across, y: BROKEN_WING.road.y + s * along + c * across };
}
export const BROKEN_WING_SITE: Vec = BROKEN_WING_POINT(BROKEN_WING.siteAt, BROKEN_WING.siteSide);

export const REGION = {
  name: "Icarus",
  size: 120 * MAP_SCALE,
  danger: 1,
  navigation: {
    heuristicWeight: 1.2,
    offRoadCost: 1.75,
    taste: { scale: 40, strength: 0.6 },
    lookahead: 48,
    slopeCost: 1,
    straighten: 0.05,
    roadShyCost: 6,
  },
  towns: [
    { id: "bowl", name: "Bowl", pos: scalePoint({ x: 16, y: 94 }), radius: 28 },
    { id: "nose", name: "Nose", pos: scalePoint({ x: 102, y: 35 }), radius: 32 },
  ] as TownDef[],
  locations: [
    { id: "orchard", name: "Old Orchard", kind: "territory", pos: ORCHARD_POS, radius: boundingRadius(ORCHARD_OUTLINE), outline: ORCHARD_OUTLINE },
    {
      id: "dustwell",
      name: "Dustwell",
      kind: "oasis",
      pos: scalePoint({ x: 33.8, y: 32 }),
      radius: 6,
    },
    {
      id: "granary",
      name: "The Granary",
      kind: "landmark",
      pos: scalePoint({ x: 50, y: 32.8 }),
      radius: 6,
    },
    {
      id: "burnt-convoy",
      edge: "wrecks",
      name: "Burnt Convoy",
      kind: "convoy",
      pos: scalePoint({ x: 60, y: 18.8 }),
      radius: 6,
    },
    {
      id: "podfield",
      edge: "wrecks",
      name: "Podfield",
      kind: "convoy",
      pos: scalePoint({ x: 78.2, y: 21 }),
      radius: 6,
    },
    {
      id: "canyon-bridge",
      edge: "fence",
      name: "Canyon Bridge",
      kind: "landmark",
      pos: scalePoint({ x: 106.2, y: 70 }),
      radius: 6,
    },
    {
      id: "glass-flats",
      name: "Glass Flats",
      kind: "territory",
      pos: GLASS_FLATS_POS,
      radius: boundingRadius(GLASS_FLATS_OUTLINE),
      outline: GLASS_FLATS_OUTLINE,
    },
    {
      id: "green-pit",
      name: "Green Pit",
      kind: "oasis",
      pos: scalePoint({ x: 71.8, y: 89 }),
      radius: 6,
    },
    {
      id: "south-lock",
      name: "South Lock",
      kind: "landmark",
      pos: scalePoint({ x: 56.8, y: 94 }),
      radius: 6,
    },
    {
      id: "ridge-wrecks",
      edge: "wrecks",
      name: "Ridge Wrecks",
      kind: "convoy",
      pos: scalePoint({ x: 41, y: 90.2 }),
      radius: 6,
    },
    {
      id: "pump-station",
      name: "Pump Station",
      kind: "landmark",
      pos: scalePoint({ x: 40.7, y: 51.7 }),
      radius: 6,
    },
    {
      id: "fallen-sun",
      name: "Fallen Sun",
      kind: "territory",
      pos: FALLEN_SUN_POS,
      radius: boundingRadius(FALLEN_SUN_OUTLINE),
      outline: FALLEN_SUN_OUTLINE,
    },
    {
      id: "salvage-yard",
      name: "Salvage Yard",
      kind: "convoy",
      pos: scalePoint({ x: 82, y: 52.2 }),
      radius: 6,
    },
    {
      id: "broken-wing",
      edge: "wrecks",
      name: "Broken Wing",
      kind: "landmark",
      pos: BROKEN_WING_SITE,
      radius: 6,
    },
    {
      id: "scrapjaw",
      name: "Scrapjaw Camp",
      kind: "camp",
      pos: scalePoint({ x: 22, y: 14 }),
      radius: 6,
    },
    {
      id: "kiln",
      name: "Kiln Camp",
      kind: "camp",
      pos: scalePoint({ x: 66, y: 76 }),
      radius: 6,
    },
  ] as LocationDef[],
  roads: [
    scaleRoad([
      { x: 16, y: 94 },
      { x: 21, y: 85 },
      { x: 25, y: 73 },
      { x: 28, y: 64 },
      { x: 31, y: 54 },
      { x: 37, y: 32 },
      { x: 43, y: 30 },
      { x: 50, y: 36 },
      { x: 55, y: 31 },
      { x: 63, y: 20 },
      { x: 70, y: 18 },
      { x: 77, y: 24 },
      { x: 89, y: 26 },
      { x: 96, y: 31 },
      { x: 102, y: 35 },
    ]),
    scaleRoad([
      { x: 16, y: 94 },
      { x: 24, y: 91 },
      { x: 41, y: 87 },
      { x: 50, y: 91 },
      { x: 58, y: 91 },
      { x: 66, y: 96 },
      { x: 73, y: 92 },
      { x: 81, y: 92 },
      { x: 88, y: 84 },
      { x: 95, y: 78 },
      { x: 103, y: 70 },
      { x: 105, y: 58 },
      { x: 102, y: 35 },
    ], [9]),
    scaleRoad([
      { x: 28, y: 64 },
      { x: 36, y: 61 },
      { x: 43, y: 54 },
      { x: 50, y: 49 },
      { x: 51, y: 38 },
      { x: 60, y: 33 },
      { x: 70, y: 33 },
      { x: 82, y: 33 },
    ], [5, 6]),
    scaleRoad([
      { x: 82, y: 33 },
      { x: 77, y: 24 },
    ]),
    scaleRoad([
      { x: 82, y: 33 },
      { x: 82, y: 49 },
    ]),
    scaleRoad([
      { x: 50, y: 36 },
      { x: 47, y: 44 },
      { x: 43, y: 54 },
    ]),
    scaleRoad([
      { x: 58, y: 91 },
      { x: 55, y: 80 },
      { x: 52, y: 71 },
      { x: 48, y: 61 },
      { x: 43, y: 54 },
    ]),
    scaleRoad([
      { x: 82, y: 49 },
      { x: 90, y: 56 },
      { x: 97, y: 62 },
      { x: 103, y: 70 },
    ]),
    [scalePoint({ x: 28, y: 64 }), edgePoint(scalePoint({ x: 28, y: 64 }), { x: ORCHARD_POS.x + ORCHARD_SOUTH.x, y: ORCHARD_POS.y + ORCHARD_SOUTH.y }, ORCHARD_POS, ORCHARD_OUTLINE)],
    [BROKEN_WING_POINT(BROKEN_WING.siteAt, 0), BROKEN_WING_SITE],
    scaleRoad([{ x: 37, y: 32 }, { x: 33.8, y: 32 }], [0]),
    scaleRoad([{ x: 50, y: 36 }, { x: 50, y: 32.8 }], [0]),
    scaleRoad([{ x: 63, y: 20 }, { x: 60, y: 18.8 }], [0]),
    scaleRoad([{ x: 77, y: 24 }, { x: 78.2, y: 21 }], [0]),
    scaleRoad([{ x: 103, y: 70 }, { x: 106.2, y: 70 }], [0]),
    scaleRoad([{ x: 73, y: 92 }, { x: 71.8, y: 89 }], [0]),
    scaleRoad([{ x: 58, y: 91 }, { x: 56.8, y: 94 }], [0]),
    scaleRoad([{ x: 41, y: 87 }, { x: 41, y: 90.2 }], [0]),
    scaleRoad([{ x: 43, y: 54 }, { x: 40.7, y: 51.7 }], [0]),
    scaleRoad([{ x: 82, y: 49 }, { x: 82, y: 52.2 }], [0]),
    ...GLASS_FLATS_APPROACHES,
    scaleRoad([
      { x: 37, y: 32 },
      { x: 30, y: 22 },
      { x: 22, y: 14 },
    ]),
    scaleRoad([
      { x: 55, y: 80 },
      { x: 61, y: 79 },
      { x: 66, y: 76 },
    ]),
    [
      ...scaleRoad([
        { x: 43, y: 54 },
        { x: 50, y: 55 },
        { x: 54, y: 57 },
      ]),
      fromFallenSun(-39.71, 9.9),
    ],
    [
      scalePoint({ x: 82, y: 49 }),
      fromFallenSun(95, -36),
      fromFallenSun(75, -37),
      fromFallenSun(58, -34),
      fromFallenSun(43.01, -21.92),
    ],
    [
      ...scaleRoad([
        { x: 66, y: 76 },
        { x: 73, y: 64 },
      ]),
      fromFallenSun(37.75, 28.44),
    ],
  ] as Vec[][],
  roadWidth: 6,
  obstacles: {
    roadWrecks: 30,
    roadWreckShoulder: [0.5, 0.85] as [number, number],
    roadClearance: 1.6,
    siteClearance: 8,
    edgeMargin: 8,
    gap: 0.45,
    maxTries: 20000,
  },
  sites: {
    convoyWrecks: [
      { x: -2.6, y: 0.6 },
      { x: 0.8, y: -2.6 },
      { x: 2.4, y: 2.2 },
      { x: -0.8, y: 2.8 },
    ] as Vec[],
    pondRadius: 2.2,
    pad: { length: 5, width: 7 },
    gateSpacing: 7,
    multiGateRadius: 12,
  },
  settlement: {
    gateWidth: 5,
    fenceHeight: 0.8,
    fenceThickness: 0.15,
    fenceSegment: 1.5,
    wreckHeight: 0.9,
    wreckThickness: 1,
    wreckSegment: 1.1,
    gatePoleHeight: 5.5,
    lampHeight: 1.6,
  },
  playerStart: { road: 0, distance: 125, offset: 45, wreck: { ahead: 6, side: 5 } },
};
