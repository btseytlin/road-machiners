// All colors in one place. Warm dust palette.

import type { Faction } from '../sim/types';

export const PAL = {
  bg: 0x1a1410,
  sand: [0xc9a878, 0xc2a070, 0xbb9868, 0xd0b080],
  sandFar: 0x8a7050,
  desertSand: 0xffaf6f, // warm ochre base that open desert ground mixes toward
  sandLight: 0xffbf86, // the light end of the slow sand patches on open desert
  sandShade: 0xe8955c, // the deep end of the slow sand patches on open desert
  road: 0xb6835e, // rust-brown packed dirt of the road surface
  roadCrack: 0x9c6c4c, // faint cracks and potholes in the road texture
  roadRim: 0xf8a667, // light sand the road edge frays into
  stoneGrey: 0x8a847d, // cool grey stones on road shoulders and in pebble clusters
  padMark: 0xd86a2a, // worn orange paint around site pads, where trucks stop to use a site
  pebble: 0x9c7c54,
  desertStone: 0xb8ab9c, // the main stone of a desert stone cluster, a light warm grey
  scrub: [0x6f6a3a, 0x5d5a32, 0x7c7442],
  brush: [0xa4ac70, 0xb4c084, 0xc8c484], // desert scrub stems: dark core, olive body, dry lit tips
  cactus: { body: 0x8a9450, shade: 0x6e7840 }, // short columnar cacti: lit column, shaded column
  rock: { top: 0x9a8a78, side: 0x6e6254, dark: 0x4e453c },
  stone: { top: 0xc98e68, side: 0xb47f5d, dark: 0x8a5e44 }, // terracotta of loose boulders, crags and pebbles
  rust: { top: 0x8a4a2a, side: 0x5e3420, dark: 0x3a2418 },
  wall: { top: 0xb89a74, side: 0x8e7454, dark: 0x6a5840 },
  roof: [0x7a5a3a, 0x5e6a5a, 0x8a3a2a],
  water: 0x4a8a8a,
  waterLight: 0x6aaaa0,
  palm: 0x4a6a2a,
  trunk: 0x6a4a2a,
  shadow: 0x2a1a10,
  shadeTint: 0x3c3046, // mauve-brown that darkens shaded ground, as the reference's shadows of issue 129
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
  flash: 0xfff0a0,
  lamp: { on: 0xfff2c8, off: 0x8a8470 }, // headlight glass, lit at night
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
