// The one region of the prototype. Coordinates are in tiles.

import type { Vec } from "../sim/vec";

export type TownDef = { id: string; name: string; pos: Vec; radius: number };
export type LocationDef = {
  id: string;
  name: string;
  kind: "oasis" | "convoy" | "landmark" | "camp";
  pos: Vec;
  radius: number;
  edge: SiteEdge;
};
export type SiteEdge = "palisade" | "camp" | "stone" | "fence" | "wrecks";
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

const FALLEN_SUN_POS = scalePoint({ x: 64, y: 54 });
const FALLEN_SUN_RADIUS = 44;

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
  },
  towns: [
    { id: "bowl", name: "Bowl", pos: scalePoint({ x: 16, y: 94 }), radius: 28 },
    { id: "nose", name: "Nose", pos: scalePoint({ x: 102, y: 35 }), radius: 32 },
  ] as TownDef[],
  locations: [
    {
      id: "orchard",
      edge: "fence",
      name: "Old Orchard",
      kind: "landmark",
      pos: scalePoint({ x: 23.2, y: 62 }),
      radius: 16,
    },
    {
      id: "dustwell",
      edge: "stone",
      name: "Dustwell",
      kind: "oasis",
      pos: scalePoint({ x: 33.8, y: 32 }),
      radius: 6,
    },
    {
      id: "granary",
      edge: "palisade",
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
      edge: "fence",
      name: "Glass Flats",
      kind: "landmark",
      pos: scalePoint({ x: 90.3, y: 86.3 }),
      radius: 6,
    },
    {
      id: "green-pit",
      edge: "stone",
      name: "Green Pit",
      kind: "oasis",
      pos: scalePoint({ x: 71.8, y: 89 }),
      radius: 6,
    },
    {
      id: "south-lock",
      edge: "fence",
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
      edge: "fence",
      name: "Pump Station",
      kind: "landmark",
      pos: scalePoint({ x: 40.7, y: 51.7 }),
      radius: 6,
    },
    {
      id: "fallen-sun",
      edge: "fence",
      name: "Fallen Sun",
      kind: "landmark",
      pos: FALLEN_SUN_POS,
      radius: FALLEN_SUN_RADIUS,
    },
    {
      id: "salvage-yard",
      edge: "palisade",
      name: "Salvage Yard",
      kind: "convoy",
      pos: scalePoint({ x: 82, y: 52.2 }),
      radius: 6,
    },
    {
      id: "scrapjaw",
      edge: "camp",
      name: "Scrapjaw Camp",
      kind: "camp",
      pos: scalePoint({ x: 22, y: 14 }),
      radius: 6,
    },
    {
      id: "kiln",
      edge: "camp",
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
      { x: 62, y: 34 },
      { x: 72, y: 38 },
      { x: 82, y: 49 },
      { x: 78, y: 36 },
      { x: 77, y: 24 },
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
      { x: 93, y: 70 },
      { x: 88, y: 84 },
    ]),
    scaleRoad([{ x: 28, y: 64 }, { x: 23.2, y: 62 }], [0]),
    scaleRoad([{ x: 37, y: 32 }, { x: 33.8, y: 32 }], [0]),
    scaleRoad([{ x: 50, y: 36 }, { x: 50, y: 32.8 }], [0]),
    scaleRoad([{ x: 63, y: 20 }, { x: 60, y: 18.8 }], [0]),
    scaleRoad([{ x: 77, y: 24 }, { x: 78.2, y: 21 }], [0]),
    scaleRoad([{ x: 103, y: 70 }, { x: 106.2, y: 70 }], [0]),
    scaleRoad([{ x: 88, y: 84 }, { x: 90.3, y: 86.3 }], [0]),
    scaleRoad([{ x: 73, y: 92 }, { x: 71.8, y: 89 }], [0]),
    scaleRoad([{ x: 58, y: 91 }, { x: 56.8, y: 94 }], [0]),
    scaleRoad([{ x: 41, y: 87 }, { x: 41, y: 90.2 }], [0]),
    scaleRoad([{ x: 43, y: 54 }, { x: 40.7, y: 51.7 }], [0]),
    scaleRoad([{ x: 82, y: 49 }, { x: 82, y: 52.2 }], [0]),
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
      { x: FALLEN_SUN_POS.x - FALLEN_SUN_RADIUS, y: FALLEN_SUN_POS.y },
    ],
    [
      ...scaleRoad([
        { x: 82, y: 49 },
        { x: 75, y: 50 },
        { x: 74, y: 56 },
      ]),
      { x: FALLEN_SUN_POS.x + FALLEN_SUN_RADIUS, y: FALLEN_SUN_POS.y },
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
    buildingsPerTown: 10,
    buildingRing: [0.62, 0.82] as [number, number],
    buildingRadius: [0.75, 1.2] as [number, number],
    roadGapAngle: 0.38,
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
    streetSpacing: 5,
    houseWidth: 2.7,
    houseDepth: 2.1,
    houseHeights: [1.1, 1.8],
    wallHeight: 1.6,
    wallThickness: 1.2,
    wallSegment: 3,
    wallTowerEvery: 5,
    gateWidth: 5,
    palisadeHeight: 1,
    palisadeThickness: 0.6,
    palisadeSegment: 1.5,
    stoneHeight: 0.6,
    stoneThickness: 0.9,
    stoneSegment: 1.2,
    fenceHeight: 0.8,
    fenceThickness: 0.15,
    fenceSegment: 1.5,
    wreckHeight: 0.9,
    wreckThickness: 1,
    wreckSegment: 1.1,
    guardTowerHeight: 2.6,
    gatePoleHeight: 5.5,
    lampHeight: 1.6,
    orchardRows: 11,
    orchardSpacing: 2,
  },
  playerStart: { road: 0, distance: 125, offset: 45 },
};
