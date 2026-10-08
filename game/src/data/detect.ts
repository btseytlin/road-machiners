// Detection beyond sight: engine sound, dust trails and radio scanners.
// Sight is TERRAIN.vision.radius. At driving speeds a normal engine is heard 2 to 4 times as far, and dust on
// hardpan is seen 4 to 6 times as far. A contact is a rough circle that shrinks as the truck nears.

export const DETECT = {
  sound: {
    limp: 24,
    perSpeed: 8,
    ownPenalty: 10,
  },
  dust: {
    perSpeed: 20,
    eyeHeight: 0.6,
    samplesPerTile: 1,
    spawnBack: 0.5,
    lifetime: 8,
    riseTurns: 1,
    riseHeight: 0.5,
    backDrift: 1.2,
    windDrift: 0.8,
    wander: 0.6,
  },
  fuzz: {
    base: 2,
    perTile: 0.35,
    radioPerTile: 0.03,
  },
} as const;
