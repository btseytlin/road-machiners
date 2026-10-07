// The one region of the prototype. Coordinates are in tiles.

import type { Vec } from "../sim/vec";

export type TownDef = { id: string; name: string; pos: Vec; radius: number };
export type SiteLocationDef = {
  id: string;
  name: string;
  kind: "oasis" | "convoy" | "landmark" | "camp";
  pos: Vec;
  radius: number;
  edge: SiteEdge;
};
// Open ground full of loot spots. It has no edge, gates or pads: trucks drive in. Its rules live in TERRITORIES.
// outline is its edge as a polygon, in tiles from pos, or null when the edge is the circle of radius. For an outline,
// radius is the outline's bounding radius, so code that only needs a reach can use it. siteGap() in src/sim/sites.ts
// decides inside and outside.
export type TerritoryDef = { id: string; name: string; kind: "territory"; pos: Vec; radius: number; outline: Vec[] | null };
export type LocationDef = SiteLocationDef | TerritoryDef;
// What closes a location on its collision edge. Towns always have a town wall.
export type SiteEdge = "palisade" | "camp" | "stone" | "fence" | "wrecks";
export const MAP_SCALE = 5;

export function scalePoint(p: Vec): Vec {
  return { x: p.x * MAP_SCALE, y: p.y * MAP_SCALE };
}

// Road bends. Between its given points a road sways sideways, so long stretches are not ruled lines.
// The given points stay on the road, so junctions and site entries keep their places.
const BEND = {
  step: 6, // tiles between points of a bent stretch
  amplitude: 0.07, // largest sway as a share of the stretch length
  maxSway: 4, // tiles of sway at most, so a road keeps well inside its old graded corridor
  wavelength: 45, // tiles per sway to one side and back
};

function scaleRoad(points: Vec[], straight: number[] = []): Vec[] {
  const scaled = points.map(scalePoint);
  const out: Vec[] = [scaled[0]];
  for (let i = 1; i < scaled.length; i++) out.push(...(straight.includes(i - 1) ? [scaled[i]] : bend(scaled[i - 1], scaled[i])));
  return out;
}

// Points after a along a sideways sway to b, ending at b. The sway is zero at both ends. Its phase
// comes from the stretch's own points, so every stretch sways its own way.
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
// The Fallen Sun's edge, in tiles from its centre (tmp/issue-81/r4/layout.md): the basin floor in TERRAIN.features.basins,
// inset 1.5 tiles from the cliff arcs so their faces stay outside, with the crash furrow's floor spliced in to the
// south-south-west. It is not a circle: the furrow reaches 112 tiles out and the crags come within 40.
const FALLEN_SUN_OUTLINE: Vec[] = [
  { x: -45.0, y: 0.0 }, // the west scree
  { x: -41.3, y: -15.0 },
  { x: -31.0, y: -26.0 }, // the left crag wall, inset
  { x: -20.9, y: -33.5 },
  { x: -11.4, y: -39.9 },
  { x: -6.3, y: -44.6 }, // the north notch, at the floor edge, so a road can leave through it
  { x: 1.6, y: -45.0 },
  { x: 7.2, y: -40.9 }, // the right crag wall and the north-east wall, inset
  { x: 15.3, y: -47.1 },
  { x: 27.8, y: -44.5 },
  { x: 37.8, y: -37.8 },
  { x: 45.9, y: -26.5 }, // the east road
  { x: 50.2, y: -8.9 }, // the east hill's foot
  { x: 50.2, y: 8.9 },
  { x: 45.3, y: 21.1 },
  { x: 39.8, y: 33.4 }, // the south-east road
  { x: 25.5, y: 44.2 },
  { x: 8.2, y: 46.3 }, // the open south
  { x: -2.4, y: 55.3 }, // down the furrow's east side
  { x: -8.6, y: 78.4 },
  { x: -13.6, y: 101.9 }, // a tile out from the furrow's east side, so the east lane past the wing's foot stays inside
  { x: -22.6, y: 115.1 }, // round the furrow's far end, 3 tiles past its floor so the tail junction behind the wing fits
  { x: -30.8, y: 114.9 },
  { x: -38.8, y: 110.9 },
  { x: -38.8, y: 95.4 }, // back up the furrow's west side, a tile out so the west lane past the wing's foot stays inside
  { x: -31.8, y: 72.2 },
  { x: -25.6, y: 49.1 },
  { x: -23.5, y: 40.7 }, // the furrow's west lip
  { x: -37.7, y: 26.4 },
  { x: -43.5, y: 11.6 }, // the west road
];
const ORCHARD_POS = { x: 114, y: 284 }; // region (22.8, 56.8), the crossroads in the flat basin west of the north trunk road
// Old Orchard's old road runs straight through its centre, in radians from map +x toward +y, pointing to its north
// end. It is set so the gameplay camera shows the road at the concept image's 25 degrees above screen right.
// The camera looks 30 degrees down from map +x +y (src/three/render/camera.ts): screen right is map (1, -1) / sqrt 2
// and screen up is map (-1, -1) / sqrt 2, foreshortened by sin 30 = 0.5. A screen direction (cos 25, sin 25) is
// cos 25 = 0.906 along screen right and 2 sin 25 = 0.845 along screen up on the ground, so on the map it is
// (0.906 - 0.845, -0.906 - 0.845) / sqrt 2: north, 2 degrees toward east.
const ORCHARD_SCREEN_ANGLE = (25 * Math.PI) / 180;
const ORCHARD_SIN_ELEVATION = 0.5;
export const ORCHARD_HEADING = Math.atan2(
  -Math.cos(ORCHARD_SCREEN_ANGLE) - Math.sin(ORCHARD_SCREEN_ANGLE) / ORCHARD_SIN_ELEVATION,
  Math.cos(ORCHARD_SCREEN_ANGLE) - Math.sin(ORCHARD_SCREEN_ANGLE) / ORCHARD_SIN_ELEVATION,
);

// A point s tiles along the Old Orchard's road from the centre (toward its north end) and c tiles across it (toward
// screen up, the map's west side), in tiles from the centre. On the map that is about x = 114 - c, y = 284 - s.
// Positions are measured from the concept image, docs/concepts/old-orchard-issue-111.jpg, and the terrain survey.
export function onOrchardRoad(s: number, c: number): Vec {
  const [cos, sin] = [Math.cos(ORCHARD_HEADING), Math.sin(ORCHARD_HEADING)];
  return { x: s * cos + c * sin, y: s * sin - c * cos };
}

// The orchard's edge follows its basin, read from the bake's terrain in the road's frame. Ridges inside it are part of
// the land. The east side keeps more than a tile off the north trunk road's edge, so the trunk road never enters it.
const ORCHARD_OUTLINE: Vec[] = [
  [-35, 22], // south-west corner, where the south-west dirt road leaves toward the old asphalt road at (100, 326)
  [-36, 2], // the south edge west of the spur, on open ground
  [-28, -3], // the spur road crosses the edge here, just before its end at the old road's south end
  [-28, -14], // the south edge east of the spur, over 1 tile off its shoulder
  [-26, -24],
  [-20, -28], // the east edge follows the north trunk road's west shoulder up the basin
  [0, -31],
  [20, -35.5],
  [40, -39],
  [50, -42],
  [56, -40], // the north-east corner, at the foot of the far north ridge
  [58, -12], // the north edge of the north-east ground, under that ridge
  [59, 3],
  [72, 6], // up the east foot of the cliff between the north-east ground and the north-west pocket
  [72, 42], // the north-west pocket's north edge, on flat ground
  [54, 40], // the pocket's west edge, at the foot of the west ridge
  [46, 37],
  [40, 34],
  [-30, 34], // the west edge, along the foot of the ridge that closes the basin's west side
].map(([s, c]) => onOrchardRoad(s, c));

// The largest distance of an outline point from the centre.
function boundingRadius(outline: readonly Vec[]): number {
  return Math.max(...outline.map((p) => Math.hypot(p.x, p.y)));
}

// The old road's south end, on its line, where the spur road from the trunk road arrives.
const ORCHARD_SOUTH = onOrchardRoad(-32, 0);

// The point where a road from `from` toward `to` first crosses the outline, RIM_REACH past it, where a spur road ends.
// The road crosses the edge a hair before its end, so floating-point error cannot leave it short of the edge.
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

// A point in tiles from the Fallen Sun's centre, on the map.
function fromFallenSun(x: number, y: number): Vec {
  return { x: FALLEN_SUN_POS.x + x, y: FALLEN_SUN_POS.y + y };
}

// Broken Wing: a crashed ship's wing lying along the road, which runs straight east-west (map yaw 0) so the wing
// lies on screen as in the concept art. From the west, the road passes under the hoop, the wing's torn root bent up
// and over it (the baked ship_wing prop, TERRAIN.features.wing). It climbs the root ramp, a sand mound, onto the wing
// deck, runs along the deck's top, and comes down the tip ramp. The site stands past the tip ramp on the +y side,
// and a crash trench runs beside the wing on the -y side. Distances are in tiles: `along` from the deck's middle
// toward +x, `across` toward +y. Everything at Broken Wing derives from this one constant.
// - road: the road's center point at the deck's middle; yaw: the road's direction, radians from map +x toward +y.
// - deckHalf: half the deck's length. The deck is TERRAIN.features.decks' broken-wing entry.
// - mound: the two ramps, TERRAIN.features.mounds. Each has a flat top of radius `flat`, falls over `bank` and stands
//   `height` height units over the ground. Its center lies `gap` past a deck end, so the end rests on the inner bank,
//   where the ground already falls away under the deck.
// - hoopAt: the hoop's place along the road, past the root ramp's foot, so the hoop and the deck never meet.
// - siteAt, siteSide: the spur leaves the road at siteAt, and the site stands siteSide across from it.
// - trench: a channel like the canyon, TERRAIN.features.trench, `side` across from the road, `half` long each way.
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

// A map point `along` the Broken Wing road from the deck's middle and `across` it toward +y, in tiles.
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
    heuristicWeight: 1.2, // Weighted A* trades at most 20% grid path cost for faster long-distance searches.
    // Route cost multiplier for every tile that is not road. On a road a driver does not have to find a
    // way, and others pass by who can help. With road speed 1 and hardpan 0.9, a road detour up to 94%
    // longer than a straight hardpan line costs less. The heuristic weight can give back 20% of that, so
    // detours up to about 60% longer, like the Bowl to Nose roads, are still followed. A road twice as
    // long as the straight line loses to open ground.
    offRoadCost: 1.75,
    // Per-driver route taste. Each NPC driver sees route cost multiplied by its own smooth noise field,
    // so drivers between the same points take different roads and shortcuts. Lattice points lie `scale`
    // tiles apart, about the size of a hill or a road bend. `strength` 0.6 scales cost from 0.7 to 1.3,
    // so a driver can prefer a road up to 86% longer. Below 0.6 every Bowl to Nose driver takes the
    // middle road past Pump Station. A road on the worst taste costs 1.3, below hardpan beside it on
    // the best taste at 0.7 x 1.75 / 0.9 = 1.36, so drivers keep to roads where they have one.
    taste: { scale: 40, strength: 0.6 },
    // Tiles of a kept route a driver re-straightens each time it reuses the route. The rest stays as
    // planned. It covers 4 turns, a real turn plus 3 preview turns, at the top speed of 11.7 tiles per
    // turn: the fastest chassis with the strongest engine.
    lookahead: 48,
    // Route cost multiplier on sloped tiles: 1 + slopeCost * (slope / cliff slope)^2. Ground at the cliff
    // slope costs 2 times flat and half the cliff slope 1.25 times, so routes skirt steep hills but cross
    // rolling ground. At 3, measured on 150 routes of the real map (issue 36), routes wound far around
    // gentle hills: 4003 waypoints, 32% over straight. At 1 they take 1248 and 24%.
    slopeCost: 1,
    // A shortcut may cost this share more than the bends it replaces, so routes take fewer bends. It stays
    // well below the road margin, so roads stay followed.
    straighten: 0.05,
  },
  towns: [
    { id: "bowl", name: "Bowl", pos: scalePoint({ x: 16, y: 94 }), radius: 28 },
    { id: "nose", name: "Nose", pos: scalePoint({ x: 102, y: 35 }), radius: 32 },
  ] as TownDef[],
  locations: [
    { id: "orchard", name: "Old Orchard", kind: "territory", pos: ORCHARD_POS, radius: boundingRadius(ORCHARD_OUTLINE), outline: ORCHARD_OUTLINE },
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
      name: "Fallen Sun",
      kind: "territory",
      pos: FALLEN_SUN_POS,
      radius: boundingRadius(FALLEN_SUN_OUTLINE),
      outline: FALLEN_SUN_OUTLINE,
    },
    {
      id: "salvage-yard",
      edge: "palisade",
      name: "Salvage Yard",
      kind: "convoy",
      pos: scalePoint({ x: 82, y: 52.2 }),
      radius: 6,
    },
    // Broken Wing: a crashed ship's wing the road runs under and along. The site stands past the tip ramp, beside
    // the road, so the deck and the hoop stay clear. See BROKEN_WING.
    {
      id: "broken-wing",
      edge: "wrecks",
      name: "Broken Wing",
      kind: "landmark",
      pos: BROKEN_WING_SITE,
      radius: 6,
    },
    // Raider camps. Raiders spawn at their gates and service there.
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
    // The north and south routes meet only beyond the canyon crossings at Podfield and Canyon Bridge.
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
    ], [9]), // the stretch over Canyon Bridge stays straight
    scaleRoad([
      { x: 28, y: 64 },
      { x: 36, y: 61 },
      { x: 43, y: 54 },
      { x: 50, y: 49 },
      { x: 51, y: 38 },
      { x: 60, y: 33 },
      { x: 70, y: 33 },
      { x: 82, y: 33 },
    ], [5, 6]), // the stretch under the Broken Wing hoop and along its deck stays straight
    // At the Broken Wing road's east end, roads leave north to Podfield and south to Salvage Yard.
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
      { x: 93, y: 70 },
      { x: 88, y: 84 },
    ]),
    // Short straight spurs lead from a road point to each location beside it, so through traffic passes by.
    // The orchard's spur ends at the south end of its old road, just inside the edge.
    [scalePoint({ x: 28, y: 64 }), edgePoint(scalePoint({ x: 28, y: 64 }), { x: ORCHARD_POS.x + ORCHARD_SOUTH.x, y: ORCHARD_POS.y + ORCHARD_SOUTH.y }, ORCHARD_POS, ORCHARD_OUTLINE)],
    [BROKEN_WING_POINT(BROKEN_WING.siteAt, 0), BROKEN_WING_SITE],
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
    // Dead-end tracks lead to the raider camps.
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
    // Three dead-end approaches come down the crater bank where the level concept's tracks leave the crater: from the
    // west (bearing 166°), the east (-27°) and the south-east (37°). Each ends 4 tiles inside the outline, on the dirt
    // road web, which takes over there (tmp/issue-81/r4/layout.md). Points are in tiles from the centre. No road goes
    // through the Fallen Sun. The east road comes in south of the small drum, on the second reference's road out of its
    // right edge, instead of round 3's -16°, where the bow, the hazard and the east shards walled it in. The south-east
    // road leaves the end of the Kiln Camp track, so raiders have a short way in.
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
    roadWrecks: 30, // wrecks placed on roads on purpose
    roadWreckShoulder: [0.5, 0.85] as [number, number], // wreck center from the road center line, as a share of the half-width
    roadClearance: 1.6, // extra gap between rocks and road edge
    siteClearance: 8, // extra gap around towns and locations
    edgeMargin: 8,
    gap: 0.45, // minimum gap between obstacles
    maxTries: 20000,
  },
  sites: {
    buildingsPerTown: 10,
    buildingRing: [0.62, 0.82] as [number, number], // buildings fit inside the non-drivable town radius
    buildingRadius: [0.75, 1.2] as [number, number],
    roadGapAngle: 0.38, // radians kept clear on each side of a road leaving a town
    convoyWrecks: [
      { x: -2.6, y: 0.6 },
      { x: 0.8, y: -2.6 },
      { x: 2.4, y: 2.2 },
      { x: -0.8, y: 2.8 },
    ] as Vec[],
    pondRadius: 2.2,
    // Tiles. A rectangular pad lies outside each gate, its inner edge on the site edge. Site services work only on a pad.
    pad: { length: 5, width: 7 }, // length runs out from the gate, width along the site edge
    gateSpacing: 7, // tiles; road crossings closer than this share one gate, so door gaps never overlap
    multiGateRadius: 12, // tiles; towns and locations at least this large get a gate per road, smaller sites get one
  },
  settlement: {
    streetSpacing: 5, // 20 m blocks, with houses separated by alleys
    houseWidth: 2.7, // 10.8 m, against the pickup's 5.2 m length
    houseDepth: 2.1,
    houseHeights: [1.1, 1.8],
    wallHeight: 1.6, // 6.4 m, well over a truck roof
    wallThickness: 1.2,
    wallSegment: 3, // tiles per straight wall section around the curve
    wallTowerEvery: 5, // wall sections between towers
    gateWidth: 5, // tiles of shut doors where a road meets any site edge
    palisadeHeight: 1, // 4 m of scrap and posts
    palisadeThickness: 0.6,
    palisadeSegment: 1.5,
    stoneHeight: 0.6, // 2.4 m of piled stone around an oasis
    stoneThickness: 0.9,
    stoneSegment: 1.2,
    fenceHeight: 0.8, // 3.2 m of posts and rails
    fenceThickness: 0.15,
    fenceSegment: 1.5,
    wreckHeight: 0.9, // 3.6 m of piled car wrecks
    wreckThickness: 1,
    wreckSegment: 1.1, // about one car length
    guardTowerHeight: 2.6, // gate towers stand a full floor over the town wall
    gatePoleHeight: 5.5, // 22 m, so a gate shows from across the fog edge
    lampHeight: 1.6, // 6.4 m gate lamp posts, lower on the higher walls and towers
  },
  // The player starts off the north trunk road, which leaves Bowl toward Old Orchard, facing the road. The road
  // point lies 125 tiles along it from Bowl's center, about 90 tiles past its wall and halfway to Old Orchard, so
  // Bowl is past grey vision. `offset` tiles to the right of that point the road lies in grey vision, past clear
  // sight, near the top edge of the screen at the widest zoom. The ground between is open. A new player drives
  // ahead and meets the road.
  playerStart: { road: 0, distance: 125, offset: 45 },
};
