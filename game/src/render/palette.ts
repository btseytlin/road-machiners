// All colors in one place. Warm dust palette.

import type { Faction } from '../sim/types';
import type { ItemTone } from './partLooks';

export const PAL = {
  bg: 0x1a1410,
  sand: [0xc9a878, 0xc2a070, 0xbb9868, 0xd0b080],
  sandFar: 0x8a7050,
  desertSand: 0xffaf6f, // warm ochre base that open desert ground mixes toward, at SAND_WARM, so the ground renders darker than this
  sandLight: 0xffbf86, // the light end of the slow sand patches on open desert
  sandShade: 0xe8955c, // the deep end of the slow sand patches on open desert
  road: 0xb6835e, // rust-brown packed dirt of the road surface
  roadCrack: 0x9c6c4c, // faint cracks and potholes in the road texture
  roadRim: 0xf8a667, // light sand the road edge frays into
  stoneGrey: 0x8a847d, // cool grey stones on road shoulders and in desert stone clusters
  padMark: 0xd86a2a, // worn orange paint around site pads, where trucks stop to use a site
  pebble: 0x9c7c54,
  desertStone: 0xb8ab9c, // the main stone of a desert stone cluster, a light warm grey
  scrub: [0x6f6a3a, 0x5d5a32, 0x7c7442],
  brush: [0x7c7a4c, 0x8c8a58, 0xa49c68], // desert scrub stems: dark core, olive body, dry lit tips
  cactus: { body: 0x70764a, shade: 0x585e3a }, // short columnar cacti: lit column, shaded column
  rock: { top: 0x9a8a78, side: 0x6e6254, dark: 0x4e453c },
  stone: { top: 0xc98e68, side: 0xb47f5d, dark: 0x8a5e44 }, // terracotta of loose boulders and crags, and the chip in desert stone clusters
  rimRock: { top: 0xbab3a6, side: 0x948e84, dark: 0x6e6960 }, // the grey crater walls of the Fallen Sun
  rust: { top: 0x8a4a2a, side: 0x5e3420, dark: 0x3a2418 },
  wall: { top: 0xb89a74, side: 0x8e7454, dark: 0x6a5840 },
  roof: [0x7a5a3a, 0x5e6a5a, 0x8a3a2a],
  water: 0x4a8a8a,
  waterLight: 0x6aaaa0,
  palm: 0x4a6a2a,
  trunk: 0x6a4a2a,
  shadow: 0x2a1a10,
  shadeTint: 0x3c3046, // mauve-brown that darkens shaded ground
  outline: 0x1a1410,
  wheel: 0x2a2420,
  metal: 0x5a5a58,
  metalLight: 0x8a8a84,
  crate: 0x9a7a4a,
  plan: 0xf0e0b8,
  dest: 0xe05030,
  throttle: { brake: 0xe05a3a, hold: 0xf0d060, accelerate: 0x7cc85a },
  select: 0xf0d060,
  utility: 0xb39a3a, // mustard hints on utility models, the border of a utility card in the inventory
  arcSpent: 0x9a9a94, // firing arc of a gun that is reloading or cooling down
  contact: 0xf4f1ea, // faint white sound waves around a contact
  smoke: 0x100e0d, // dense black smoke clouds from smoke utilities
  caltrops: { spike: 0x9a9a94 }, // steel spikes
  oil: { slick: 0x0c0b0a }, // a glossy black oil slick; its rainbow sheen is drawn in its texture
  rope: 0x16130f, // a harpoon line, black tarred rope
  pulse: { flash: 0xc8ecff, arc: 0x9fd8ff, spark: 0xd8f0ff }, // an emitter pulse's flash and arcs and the sparks on a shut-down truck, electric blue-white
  flare: { core: 0xffffff, halo: 0xff3a2a, light: 0xff4a3a, marker: 0xff6a50, casing: 0x9a3426, trail: 0xb8b0a8 }, // a burning flare's white core, its red glow and red light, the contact blip it gives, and its red casing and pale smoke trail in flight
  shell: { casing: 0x2a2622, trail: 0x8a8580 }, // a smoke mortar's round in flight and its gray trail
  dustTrail: 0xe0c49a, // dust streak behind a contact seen by its dust, pale so it shows over fog
  radio: 0x8fe0c8, // crisp scanner blip
  beacon: 0xff4030, // red rings spreading from the player's truck while its emergency beacon calls
  flash: 0xfff0a0,
  lamp: { on: 0xfff2c8, off: 0x8a8470 }, // headlight glass, lit at night
  radioLight: { on: 0xff3020, off: 0x4a1a14 }, // antenna bulb, lit while the truck is on the radio
  truckGlow: 0xffffff, // faint white light over the player truck at night
  reactorLight: 0x38d6e8, // the reactor's light, bluer than its core so on warm sand and hull it still reads green-teal
  reactorGlow: 0x5cf0b4, // the Fallen Sun reactor core, green-teal as in the level concept
  hull: { light: 0xc4baa6, grey: 0x8e887c, dark: 0x6e6a62, rust: 0x7e5634 }, // the Fallen Sun's off-white and grey hull metal and its rust streaks
  scree: 0x8e5e44, // the red-brown scree slope on a crater bank, warm like the level concept's upper-left slope
  dirtRoad: 0x8e7d69, // the Fallen Sun's grey-brown dirt roads: about 0.7 of PAL.sand[0]'s value, as reference 3's #6e5e50 roads over its #a08a70 islands, and greyer than the sand
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

// Item icon backgrounds by category tone, from itemTone() in partLooks.ts. The inventory grid boxes, loot chips, standalone
// item icons and card borders set them as --tone, and the icon atlases fill their tiles with them. Each keeps at least
// 4.5:1 contrast with LINE_STYLE.line.
export const ITEM_TONES = { weapon: 0x8c3a30, armor: 0x686c6f, cargo: 0x6e5236, other: 0x35587a } satisfies Record<ItemTone, number>;

// The item icons' line style, drawn by src/three/icons/render.ts: thick lines in line over a see-through fill, so the
// tone shows darker inside the shape. fillAlpha is 0-255.
export const LINE_STYLE = { line: 0xf4efe6, fill: 0x000000, fillAlpha: 77 };

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
