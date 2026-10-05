// Physics driving numbers. Lengths in meters, time in seconds, mass in kilograms.

export const PHYSICS = {
  metersPerTile: 4, // one map tile and one height unit are this many meters
  gravity: 9.81,
  stepsPerSecond: 60,
  turnSeconds: 1, // simulated time per turn; tiles per turn in the rules become tiles per second
  truck: {
    gravityScale: 2, // trucks fall faster than the world's gravity, so bumps do not throw them in the air
    comBelow: 0.7, // meters the center of mass sits below the chassis box center, near the axles, so trucks rarely flip
    flipTilt: 60, // degrees of body tilt from upright past which a truck counts as flipped
    liftedRise: 0.5, // meters above its ride height past which a truck counts as lifted off the ground; above suspensionTravel, so no wheel reaches
    inertiaScale: 2, // rotational inertia relative to a plain box of the same mass, so trucks resist rolling
    suspensionRest: 0.4,
    suspensionTravel: 0.3,
    suspensionStiffness: 30,
    suspensionCompression: 4,
    suspensionRelaxation: 5,
    maxSuspensionForce: 100000,
    frictionSlip: 2,
    sideFrictionStiffness: 1,
    engineAccel: 12, // m/s^2 the engine can give at full throttle, before damage
    climbReserve: 0.25, // share of engine force a truck adds against a climb, never more than the climb's pull: a low gear that raises the steepest holdable grade by about a fifth in sine without speeding up flat starts
    brakeForce: 60, // per wheel per ton of chassis handling mass, at full brake
    maxSteer: 0.6, // radians of front wheel angle
    steerRate: 3, // radians per second the wheels can turn
  },
  // One deck cell in meters, as the base models are built. Only the drawing of parts still reads it. Sim code goes through the projection in src/sim/body.ts.
  cell: { across: 0.484, along: 0.65 },
  // Body per chassis look, in meters. Length and width come from the base model. halfHeight: chassis box half height.
  // wheelX: axle distance from the center. wheelZ: wheel distance from the center line. wheelY: suspension mount height relative to the chassis center.
  // engine: the center of the hood hole on the bay floor, in body space. Mass comes from src/sim/mass.ts.
  bodies: {
    pickup: { halfHeight: 0.45, wheelY: -0.3, wheelX: 1.625, wheelZ: 0.968, engine: { x: 1.3, y: 0.05, z: -0.242 }, wheelRadius: 0.45, wheelHalfWidth: 0.18 },
    hauler: { halfHeight: 0.6, wheelY: -0.4, wheelX: 1.95, wheelZ: 1.452, engine: { x: 1.625, y: 1.21, z: -0.242 }, wheelRadius: 0.6, wheelHalfWidth: 0.25 },
    buggy: { halfHeight: 0.35, wheelY: -0.2, wheelX: 0.975, wheelZ: 0.726, engine: { x: 0.65, y: 0.05, z: 0 }, wheelRadius: 0.5, wheelHalfWidth: 0.22 },
    wagon: { halfHeight: 0.7, wheelY: -0.45, wheelX: 1.3, wheelZ: 0.968, engine: { x: 0.325, y: 0.3, z: -0.242 }, wheelRadius: 0.6, wheelHalfWidth: 0.25 },
    courier: { halfHeight: 0.3, wheelY: -0.2, wheelX: 1.3, wheelZ: 0.726, engine: { x: 0.975, y: 0, z: 0 }, wheelRadius: 0.4, wheelHalfWidth: 0.16 },
    van: { halfHeight: 0.5, wheelY: -0.35, wheelX: 1.95, wheelZ: 0.968, engine: { x: 1.625, y: 0.36, z: -0.242 }, wheelRadius: 0.45, wheelHalfWidth: 0.18 },
    longbed: { halfHeight: 0.55, wheelY: -0.35, wheelX: 2.6, wheelZ: 1.452, engine: { x: 2.275, y: 0.35, z: -0.242 }, wheelRadius: 0.6, wheelHalfWidth: 0.25 },
    carrier: { halfHeight: 0.6, wheelY: -0.4, wheelX: 1.95, wheelZ: 1.21, engine: { x: 0.325, y: 0.4, z: -0.484 }, wheelRadius: 0.65, wheelHalfWidth: 0.28 },
    tractor: { halfHeight: 0.65, wheelY: -0.45, wheelX: 1.95, wheelZ: 1.452, engine: { x: 1.625, y: 0.5, z: -0.242 }, wheelRadius: 0.7, wheelHalfWidth: 0.3 },
    jeep: { halfHeight: 0.4, wheelY: -0.25, wheelX: 1.3, wheelZ: 0.726, engine: { x: -0.975, y: 0, z: 0 }, wheelRadius: 0.45, wheelHalfWidth: 0.18 },
    convertible: { halfHeight: 0.35, wheelY: -0.2, wheelX: 1.95, wheelZ: 0.968, engine: { x: -1.625, y: -0.03, z: -0.242 }, wheelRadius: 0.42, wheelHalfWidth: 0.17 },
    bus: { halfHeight: 0.8, wheelY: -0.55, wheelX: 2.925, wheelZ: 1.21, engine: { x: -1.95, y: 1.05, z: 0 }, wheelRadius: 0.55, wheelHalfWidth: 0.22 },
    loader: { halfHeight: 0.65, wheelY: -0.45, wheelX: 1.95, wheelZ: 1.452, engine: { x: -0.975, y: 0.5, z: -0.242 }, wheelRadius: 0.8, wheelHalfWidth: 0.32 },
  },
  driver: {
    steerGain: 1.6, // wheel angle per radian of heading error
    throttleGain: 0.5, // throttle per m/s of speed error
    stopDecel: 8, // m/s^2 a driver plans to brake at when stopping on a point, at handling mass
    cornerAccel: 15, // m/s^2 sideways a driver plans to corner at; trucks orbit a missed point at about 30 on flat ground
    cornerCut: 8, // meters before a route corner where the driver starts its turn, and after it where the turn ends
    reverseBelow: 4, // m/s; only a truck slower than this starts backing up
    reverseSpeed: 5, // m/s while backing up
    stallSpeed: 0.3, // m/s; a truck pushing at a point behind it slower than this is blocked in front
    stallSeconds: 0.5, // seconds blocked in front before the truck backs up; a truck from rest passes stallSpeed sooner
  },
  rockHeight: 3, // meters of obstacle collider height
  rockSink: 0.5, // meters an obstacle collider reaches below the ground, so slopes leave no gap
  // Meters above the ground past which a prop box is no collider, so trucks pass under canopies and boards.
  // A truck collider stops at truckRoof at rest; the 0.5 m above it leave room for suspension bounce.
  truckRoof: 2.3,
  truckClearance: 2.8,
  // Tiles past the reach of trucks with bodies within which props keep colliders: more than a turn at the top speed
  // of the fastest kit, 15.6 tiles, plus the longest truck.
  propLiveMargin: 20,
  bridge: { deckThickness: 0.6, railHeight: 1.6, railThickness: 0.3 }, // meters
  wallHeight: 200, // meters; half height of the walls at the map edge
} as const;
