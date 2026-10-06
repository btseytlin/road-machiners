// Visual-only dust moving over the region. Distances are in map tiles; speeds are tiles per second.
export const WEATHER = {
  cloudSpacing: 30,
  stormSpacing: 90,
  wind: { x: 0.4, y: -0.14 },
  cloud: { puffs: 4, spread: 2, diameter: 3.5, height: 1.3, opacity: 0.36, color: 0xd5b58a },
  // A storm bank fills its sim radius, with one puff per tilesPerPuff square tiles of area.
  // fadePerSecond is render-only: the share of full haze per second a bank's opacity moves toward its storm's sim strength.
  storm: { tilesPerPuff: 80, diameter: 16, height: 1.2, opacity: 0.35, color: 0x9d7954, fadePerSecond: 0.5 },
  // Sim weather: storms are moving areas, heat waves and overcast cover the whole region.
  sim: {
    // Chance per turn to spawn a new event of that kind, checked only while fewer than maxActive of that kind last.
    spawnChance: { storm: 0.01, heatwave: 0.004, overcast: 0.004 },
    maxActive: { storm: 3, heatwave: 1, overcast: 1 },
    duration: { storm: [150, 400] as [number, number], heatwave: [25, 50] as [number, number], overcast: [25, 50] as [number, number] },
    stormRadius: [60, 120] as [number, number], // tiles
    stormSpeed: [0.4, 1.0] as [number, number], // tiles per turn
    stormEdge: 25, // tiles; a storm's effects fade in linearly over this depth inside its radius
    stormFadeTurns: 30, // turns a storm takes to build to full strength, and to clear before it ends
    effects: {
      // Multipliers on sight, top speed and wear, and extra scatter in radians, inside a storm.
      storm: { sight: 0.4, spread: 0.15, speed: 0.6, wear: 1.5 },
      // Multiplier on the sun-driven share of heat above 1. Overcast cancels it; a heat wave amplifies it.
      heatwave: 1.6,
      overcast: 0,
    },
  },
} as const;
