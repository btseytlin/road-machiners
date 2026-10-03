// All colors in one place. Warm dust palette.

import type { Faction } from '../sim/types';

export const PAL = {
  bg: 0x1a1410,
  sand: [0xc9a878, 0xc2a070, 0xbb9868, 0xd0b080],
  sandFar: 0x8a7050,
  road: 0xa8865a,
  roadRut: 0x937450,
  roadCrack: 0x86684a, // cracks and potholes in the road texture
  padMark: 0xd86a2a, // worn orange paint around site pads, where trucks stop to use a site
  pebble: 0x9c7c54,
  scrub: [0x6f6a3a, 0x5d5a32, 0x7c7442],
  rock: { top: 0x9a8a78, side: 0x6e6254, dark: 0x4e453c },
  rust: { top: 0x8a4a2a, side: 0x5e3420, dark: 0x3a2418 },
  wall: { top: 0xb89a74, side: 0x8e7454, dark: 0x6a5840 },
  roof: [0x7a5a3a, 0x5e6a5a, 0x8a3a2a],
  water: 0x4a8a8a,
  waterLight: 0x6aaaa0,
  palm: 0x4a6a2a,
  trunk: 0x6a4a2a,
  shadow: 0x2a1a10,
  outline: 0x1a1410,
  wheel: 0x2a2420,
  metal: 0x5a5a58,
  metalLight: 0x8a8a84,
  crate: 0x9a7a4a,
  plan: 0xf0e0b8,
  dest: 0xe05030,
  throttle: { brake: 0xe05a3a, hold: 0xf0d060, accelerate: 0x7cc85a },
  select: 0xf0d060,
  arcSpent: 0x9a9a94, // firing arc of a gun that is reloading or cooling down
  contact: 0xf4f1ea, // faint white sound waves around a contact
  dustTrail: 0xe0c49a, // dust streak behind a contact seen by its dust, pale so it shows over fog
  radio: 0x8fe0c8, // crisp scanner blip
  beacon: 0xff4030, // red rings spreading from the player's truck while its emergency beacon calls
  flash: 0xfff0a0,
  lamp: { on: 0xfff2c8, off: 0x8a8470 }, // headlight glass, lit at night
  radioLight: { on: 0xff3020, off: 0x4a1a14 }, // antenna bulb, lit while the truck is on the radio
  truckGlow: 0xffffff, // faint white light over the player truck at night
  reactorGlow: 0x7cff5a, // the Fallen Sun reactor core and the light it throws
  text: '#f0e0b8',
  textDim: '#b8a888',
  damageText: '#ff4a3a', // damage popups over a hit truck
};

export const FACTION_COLORS: Record<Faction, { top: number; side: number; cab: number; cabSide: number }> = {
  player: { top: 0x9c7a3e, side: 0x6e5428, cab: 0x7e8a5a, cabSide: 0x566040 },
  raiders: { top: 0x8e2e22, side: 0x5e1e18, cab: 0x3a3230, cabSide: 0x262020 },
  traders: { top: 0x5e7a8a, side: 0x3e5260, cab: 0xb8a070, cabSide: 0x8a7650 },
  scavengers: { top: 0x7a6a4a, side: 0x524630, cab: 0x5a6a4a, cabSide: 0x3e4a32 },
  bowl: { top: 0x5a7a3a, side: 0x3e5628, cab: 0xc8b070, cabSide: 0x9a8650 }, // field green with a straw cab
  nose: { top: 0x5e6038, side: 0x40422a, cab: 0xa89a70, cabSide: 0x7e7452 }, // olive drab with a khaki cab
  couriers: { top: 0xd0a030, side: 0x9a741e, cab: 0x6a5a40, cabSide: 0x4a3e2c }, // bright ochre
  roamers: { top: 0x4e8078, side: 0x345a54, cab: 0x8a8068, cabSide: 0x625a48 }, // dusty teal
  vultures: { top: 0x3a2e26, side: 0x261e18, cab: 0xc8b89a, cabSide: 0x9a8a70 }, // carrion brown with a bone cab
  convoys: { top: 0xb8b8b0, side: 0x86867e, cab: 0x9a5a34, cabSide: 0x6e3e24 }, // white-grey with rust
  mercs: { top: 0x2a2a2c, side: 0x1a1a1c, cab: 0x5a6068, cabSide: 0x3e4248 }, // black with gunmetal
};

// Multiply a color's channels by k.
export function shade(color: number, k: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * k));
  const b = Math.min(255, Math.round((color & 0xff) * k));
  return (r << 16) | (g << 8) | b;
}

export function mix(a: number, b: number, t: number): number {
  const u = 1 - t;
  const r = Math.round(((a >> 16) & 0xff) * u + ((b >> 16) & 0xff) * t);
  const g = Math.round(((a >> 8) & 0xff) * u + ((b >> 8) & 0xff) * t);
  const bl = Math.round((a & 0xff) * u + (b & 0xff) * t);
  return (r << 16) | (g << 8) | bl;
}
