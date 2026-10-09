import { FACTION_COLORS, PAL } from '../../../render/palette';
import { hash2 } from '../../../render/noise';
import { model, socket } from '../models';
import { hoist, slew } from '../site-motion';
import type { SiteBuilder } from '../sites';
import { addShed } from './shed';

const CRANE = { x: 0.1, z: 1.3, yaw: (160 * Math.PI) / 180 };
const SLEW = { amplitude: (35 * Math.PI) / 180, period: 14 };
const HOIST = { range: 2, period: 7 };
const HANG = 5.2;
const CONTAINER = { x: -1.85, z: 2.55, yaw: 0, length: 1.5, width: 0.6, height: 0.65, ribs: 6 };
const YARD_SHED = { x: -1.55, z: -0.1, yaw: 0 };
const STACKS = [
  { x: -2.55, z: 0.95, yaw: Math.PI / 2, layers: 6 },
  { x: -1.3, z: 1.75, yaw: 0.25, layers: 5 },
  { x: 0.6, z: -2.0, yaw: 0, layers: 4 },
];
const SLAB = { length: 1.05, height: 0.12, width: 0.45, shift: 0.04, twist: 0.08 };
const SLAB_COLORS = [PAL.rust.top, PAL.rust.side, PAL.rust.dark, PAL.metal, FACTION_COLORS.convoys.side];
const JEEP = { x: 1.3, z: -0.3, yaw: 0.5 };
const WRECKS = [{ x: 1.5, z: 0.9, yaw: 1.9 }];
const YARD_PROPS = [
  { name: 'crates', x: 1.5, z: -1.6, yaw: 0.3 },
  { name: 'drums', x: -0.3, z: -1.2, yaw: 1.2 },
] as const;

export function buildSalvageYard(b: SiteBuilder): void {
  addCrane(b);
  addContainer(b);
  addShed(b, 'salvage', YARD_SHED);
  for (const stack of STACKS) addScrapStack(b, stack);
  b.addModel('wreck', JEEP.x, JEEP.z, JEEP.yaw).name = 'salvage-jeep';
  for (const w of WRECKS) b.addModel('wreck', w.x, w.z, w.yaw).name = 'salvage-wreck';
  for (const p of YARD_PROPS) b.addModel(p.name, p.x, p.z, p.yaw);
}

function addCrane(b: SiteBuilder): void {
  const base = b.addModel('crane_base', CRANE.x, CRANE.z, CRANE.yaw);
  base.name = 'salvage-crane';
  const upper = model('crane_upper');
  upper.name = 'crane-upper';
  upper.position.copy(socket('crane_base', 'slew'));
  base.add(upper);
  const grab = model('crane_grab');
  grab.name = 'crane-grab';
  grab.position.copy(socket('crane_upper', 'hook'));
  grab.position.y -= HANG;
  upper.add(grab);
  b.addMover(upper, slew(SLEW.amplitude, SLEW.period));
  b.addMover(grab, hoist(HOIST.range, HOIST.period));
}

function addContainer(b: SiteBuilder): void {
  const { x, z, yaw, length, width, height, ribs } = CONTAINER;
  b.addBox(x, z, length, height, width, FACTION_COLORS.convoys.top, 0, yaw).name = 'salvage-container';
  const along = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  for (let i = 0; i < ribs; i++) {
    const t = ((i + 0.5) / ribs - 0.5) * length;
    b.addBox(x + along.x * t, z + along.z * t, 0.03, height - 0.04, width + 0.03, FACTION_COLORS.convoys.side, 0.02, yaw);
  }
}

function addScrapStack(b: SiteBuilder, stack: { x: number; z: number; yaw: number; layers: number }): void {
  for (let k = 0; k < stack.layers; k++) {
    const jitter = (salt: number) => hash2(k * 7 + salt, Math.round(stack.x * 100 + stack.z * 10)) - 0.5;
    const color = SLAB_COLORS[Math.floor((jitter(3) + 0.5) * SLAB_COLORS.length)];
    const slab = b.addBox(stack.x + jitter(1) * SLAB.shift, stack.z + jitter(2) * SLAB.shift, SLAB.length, SLAB.height, SLAB.width, color, k * SLAB.height, stack.yaw + jitter(4) * SLAB.twist);
    if (k === 0) slab.name = 'salvage-stack';
  }
}
