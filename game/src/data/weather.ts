// Visual-only dust moving over the region. Distances are in map tiles; speeds are tiles per second.
export const WEATHER = {
  cloudSpacing: 30,
  stormSpacing: 90,
  wind: { x: 0.4, y: -0.14 },
  cloud: { puffs: 4, spread: 2, diameter: 3.5, height: 1.3, opacity: 0.36, color: 0xd5b58a },
  storm: { tilesPerPuff: 80, diameter: 16, height: 1.2, opacity: 0.35, color: 0x9d7954 },
  sim: {
    spawnChance: { storm: 0.01, heatwave: 0.004, overcast: 0.004 },
    maxActive: { storm: 3, heatwave: 1, overcast: 1 },
    duration: { storm: [150, 400] as [number, number], heatwave: [25, 50] as [number, number], overcast: [25, 50] as [number, number] },
    stormRadius: [60, 120] as [number, number],
    stormSpeed: [0.4, 1.0] as [number, number],
    stormEdge: 25,
    effects: {
      storm: { sight: 0.4, spread: 0.15, speed: 0.6, wear: 1.5 },
      heatwave: 1.6,
      overcast: 0,
    },
  },
} as const;
