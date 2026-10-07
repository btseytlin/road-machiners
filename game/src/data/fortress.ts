// Fortress sites: the inhabited sites, walled by baked wall, tower, gatehouse, bastion and inner gate pieces.
// Lengths are in tiles of 4 m. The piece models are built to these sizes: walls 3 tiles high, and towers,
// bastions and gatehouses at least 3 tiles high, so each stands over 3x the tallest truck.

export type FortressShape = 'circle' | 'square' | 'star' | 'bastioned';
export type FortressStyle = 'masonry' | 'shipMetal' | 'scrap' | 'patchwork' | 'compound' | 'ring' | 'yard';
export type FortressKind = 'wall' | 'tower' | 'gate' | 'bastion' | 'inner';
// A bastioned trace. A bastion points out at each capital bearing, in degrees from the site's turn, counterclockwise.
// The curtains are the straight lines between the inner vertices, curtain tiles from the center on each capital. A
// bastion is an arrowhead: its salient stands on the capital at salient tiles, and its flanks run flank tiles out from
// the curtains, gorge tiles either side of the inner vertex. A tower stands on the salient and on both shoulders.
export type FortressBastions = { capitals: readonly number[]; curtain: number; salient: number; gorge: number; flank: number };
// A terraced pit dug into the ground inside the curtain. margin tiles in from the curtain line stay at the rim, then
// the ground steps down stepHeight tiles every terraceWidth tiles, up to terraces steps, to a flat floor.
export type FortressPit = { margin: number; terraceWidth: number; stepHeight: number; terraces: number };
// turn rotates the outline in degrees from map +x toward +y. It is tuned so every gate stays clear of the outline
// corners: mid-side on a square and between towers on a circle. South Lock's one gate stands on a star point.
// A circle has towers unless towers is false, and one every towerEvery sections, else FORTRESS.circleTowerEvery.
// rock: the stretches of outline a rock mass closes, each in degrees from the site's turn, counterclockwise from `from`
// to `to`. No wall or tower stands on an outline segment whose middle lies in one. The walls either side end in the rock.
export type FortressRock = { from: number; to: number };
export type FortressSite = { shape: FortressShape; turn: number; style: FortressStyle; bastions?: FortressBastions; towers?: boolean; towerEvery?: number; pit?: FortressPit; rock?: readonly FortressRock[] };

// A gatehouse footprint, width along the wall and depth out of the site, and its height to the parapet.
export type FortressGate = { width: number; depth: number; height: number };
// flush: the gatehouse stands in the curtain with its outer face on the curtain line. Otherwise its outer face lies
// on the site circle, and a barbican joins it back to the curtain where the curtain misses it.
// gateFlare: how far a gatehouse model's plinth and door detail reach past its outer face. Its face stands this far in.
// pieces: the pieces the style has models for. Laying any other piece throws.
export type FortressStyleDef = { flush: boolean; gate: FortressGate; gateFlare: number; pieces: readonly FortressKind[] };

export const FORTRESS_SITES: Record<string, FortressSite> = {
  // A star fort after the committee's ruling on the Bowl concept: six arrowhead bastions, with a tower on each point
  // and each shoulder, so every curtain and face lies in a tower's line of sight. Each gate is mid-curtain: the
  // capitals either side of it, at -85.34, -44.52 and -3.7 degrees, are equal in angle from its bearings, -64.93 and
  // -24.11, so its curtain faces straight out along it.
  bowl: {
    shape: 'bastioned',
    turn: 0,
    style: 'patchwork',
    bastions: { capitals: [-85.34, -44.52, -3.7, 60, 128, 198], curtain: 21.5, salient: 26.75, gorge: 2.5, flank: 2.5 },
    // C1 drops from the rim through three crop terraces to a floor, 8 m down. Four 0.5-tile steps give the three
    // terraces and a floor from the main enclosure's margin. A step stays under the 0.6 drive slope, so a road sample
    // that lands on a riser is still drivable.
    pit: { margin: 1, terraceWidth: 1.8, stepHeight: 0.5, terraces: 4 },
  },
  // C5's close towers: one every 3 sections, about 23 m apart. Turns 3.75 to 9.75 clear both 24 m flush gates.
  // The ring was built around the crashed ship, up to the flanks of the mountain it came down on. The mountain
  // (nose_rise.py) covers the curtain line from 225 to 355 degrees past the turn: north of the WNW gate's open ground,
  // round the back, to where its bent front meets the curtain in the east. The rock stretch lies a few degrees inside,
  // so each wall end reaches into the rock. A test checks the walls' ends against the rock's boxes.
  nose: { shape: 'circle', turn: 8, style: 'shipMetal', towerEvery: 3, rock: [{ from: 228, to: 352 }] },
  dustwell: { shape: 'square', turn: 45, style: 'compound' },
  'green-pit': { shape: 'circle', turn: 8, style: 'masonry' },
  'pump-station': { shape: 'square', turn: 0, style: 'masonry' },
  // The 8 m gate is as wide as one of the 15 ring sections. Turn 30 put its ends on two bends, where the next walls
  // bend out in front of it. At 36 the gate face lies along one section and 6 degrees off the road's bearing.
  granary: { shape: 'circle', turn: 36, style: 'ring', towers: false },
  'salvage-yard': { shape: 'square', turn: 45, style: 'yard' },
  'south-lock': { shape: 'star', turn: 4, style: 'masonry' },
  scrapjaw: { shape: 'circle', turn: -10, style: 'scrap' },
  kiln: { shape: 'square', turn: 93, style: 'scrap' },
};

// The ground the bake raises around Nose's mountain, so its foot is a slope of the landscape. Tiles. The ground
// under the rock stands `height` up, 5 m, under the rock's 8 m foot, and falls to the plain over `run` tiles from the
// rock's boxes, a 0.125 grade any truck climbs. It stays at the plain within `clear` tiles of a road's edge or a pad and
// rises over `ramp` tiles past that, and it stays at the plain inside the site circle.
export const NOSE_APRON = { height: 1.25, run: 10, clear: 4, ramp: 4 };

export const FORTRESS = {
  // Gap from the site circle in to the outline corners. A corner tower's half diagonal, 0.75 * sqrt(2), fits in it.
  inset: 1.25,
  wallLength: 2, // the wall model's length, 8 m. Walls stretch along their length to fit, and keep height and depth.
  wallDepth: 0.75, // wall thickness, 3 m. Each wall reaches half of it past both ends, so joints close.
  stretch: [0.6, 1.6] as [number, number], // allowed wall length as a share of wallLength
  towerSize: 1.5, // square tower footprint, 6 m
  bastionBack: 0.4, // a bastion model's tip reaches 6.4 m past its origin. It stands this far back from the corner, so the tip stays in the circle.
  bastionSize: 1.5, // square footprint of a star point bastion, 6 m
  // The castle gatehouse of the masonry and scrap styles, 16 m high (fort_kit.py GATE_HEIGHT).
  gate: { width: 5, depth: 2.5, height: 4 } as FortressGate,
  gunLift: 0.2, // the gate gun's muzzle stands this far over the gatehouse parapet
  innerWidth: 3, // inner gate in the curtain behind a barbican, along the wall. Its depth is wallDepth.
  circleTowerEvery: 5, // circle wall sections between towers
  flankMin: 2, // the least distance a flanking tower stands out past the wall it covers
  starPoints: 5,
  starDepth: 0.4, // re-entrant corners lie this share of the outline radius in from the points
  // Least gap from a corner to the edge of a gatehouse, or to the ends of a barbican's inner gate and neck walls.
  // A corner may lie deep inside a gatehouse, which then stands in for its tower.
  gateClearance: 1,
};

const CASTLE: FortressStyleDef = { flush: false, gate: FORTRESS.gate, gateFlare: 0.08, pieces: ['wall', 'tower', 'gate', 'bastion', 'inner'] };

// Each style's gatehouse and pieces. The flush gates follow the concepts C1-C5, and their models reach nothing past
// their outer face.
export const FORTRESS_STYLES: Record<FortressStyle, FortressStyleDef> = {
  masonry: CASTLE,
  scrap: CASTLE,
  // C1: an X-braced double gate between two concrete pillars.
  patchwork: { flush: true, gate: { width: 3, depth: 1.25, height: 3 }, gateFlare: 0, pieces: ['wall', 'tower', 'gate'] },
  // C2: shut rust doors in a concrete frame.
  compound: { flush: true, gate: { width: 2, depth: 1, height: 3 }, gateFlare: 0, pieces: ['wall', 'tower', 'gate'] },
  // C3: a recessed portal in a ring with no towers.
  ring: { flush: true, gate: { width: 2, depth: 1, height: 3 }, gateFlare: 0, pieces: ['wall', 'gate'] },
  // C4: rust plate leaves.
  yard: { flush: true, gate: { width: 2.5, depth: 1, height: 3 }, gateFlare: 0, pieces: ['wall', 'tower', 'gate'] },
  // C5: shut plank doors between two built-in towers joined by a catwalk. The model is 5.5 m deep in a 6 m footprint.
  shipMetal: { flush: true, gate: { width: 6, depth: 1.5, height: 4.5 }, gateFlare: 0, pieces: ['wall', 'tower', 'gate'] },
};
