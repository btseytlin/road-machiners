// Fortress sites: the inhabited sites, walled by baked wall, tower, gatehouse, bastion and inner gate pieces.
// Lengths are in tiles of 4 m. The piece models are built to these sizes: walls 3 tiles high, and towers,
// bastions and gatehouses 4 tiles high, so each stands over 3x the tallest truck.

export type FortressShape = 'circle' | 'square' | 'star';
export type FortressStyle = 'masonry' | 'shipMetal' | 'scrap';
// turn rotates the outline in degrees from map +x toward +y. It is tuned so every gate stays clear of the outline
// corners: mid-side on a square and between towers on a circle. South Lock's one gate stands on a star point.
export type FortressSite = { shape: FortressShape; turn: number; style: FortressStyle };

export const FORTRESS_SITES: Record<string, FortressSite> = {
  bowl: { shape: 'star', turn: 27.5, style: 'masonry' },
  nose: { shape: 'circle', turn: 9, style: 'shipMetal' },
  dustwell: { shape: 'square', turn: 45, style: 'masonry' },
  'green-pit': { shape: 'circle', turn: 8, style: 'masonry' },
  'pump-station': { shape: 'square', turn: 0, style: 'masonry' },
  granary: { shape: 'circle', turn: 30, style: 'masonry' },
  'salvage-yard': { shape: 'square', turn: 45, style: 'scrap' },
  'south-lock': { shape: 'star', turn: 4, style: 'masonry' },
  scrapjaw: { shape: 'circle', turn: -10, style: 'scrap' },
  kiln: { shape: 'square', turn: 93, style: 'scrap' },
};

export const FORTRESS = {
  // Gap from the site circle in to the outline corners. A corner tower's half diagonal, 0.75 * sqrt(2), fits in it.
  inset: 1.25,
  wallLength: 2, // the wall model's length, 8 m. Walls stretch along their length to fit, and keep height and depth.
  wallDepth: 0.75, // wall thickness, 3 m. Each wall reaches half of it past both ends, so joints close.
  stretch: [0.6, 1.6] as [number, number], // allowed wall length as a share of wallLength
  towerSize: 1.5, // square tower footprint, 6 m
  bastionBack: 0.4, // a bastion model's tip reaches 6.4 m past its origin. It stands this far back from the corner, so the tip stays in the circle.
  bastionSize: 1.5, // square footprint of a star point bastion, 6 m
  gate: { width: 5, depth: 2.5, height: 4 }, // gatehouse footprint, width along the wall and depth out of the site, and its 16 m height (fort_kit.py GATE_HEIGHT)
  gunLift: 0.2, // the gate gun's muzzle stands this far over the gatehouse parapet
  gateFlare: 0.08, // how far a gatehouse model's plinth and door detail reach past its outer face, 0.32 m. Its face stands this far inside the circle.
  innerWidth: 3, // inner gate in the curtain behind a barbican, along the wall. Its depth is wallDepth.
  circleTowerEvery: 5, // circle wall sections between towers
  starPoints: 5,
  starDepth: 0.4, // re-entrant corners lie this share of the outline radius in from the points
  // Least gap from a corner to the edge of a gatehouse, or to the ends of a barbican's inner gate and neck walls.
  // A corner may lie deep inside a gatehouse, which then stands in for its tower.
  gateClearance: 1,
};
