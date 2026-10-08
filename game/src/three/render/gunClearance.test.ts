// A gun's drawn head never passes through a drawn item or the truck body at any yaw its fire spans allow.
// The oracle turns the real head vertices through the sweep and tests them against boxes from the placement helpers.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHASSIS } from '../../data/chassis';
import { NPCS } from '../../data/npcs';
import { partDef } from '../../data/parts';
import { BODY_PARTS, partModel, weaponLook } from '../../render/partLooks';
import { aimWithin, gunSpans } from '../../sim/armor';
import { cellRect, highestUnder, restOn, surfaceSamples } from '../../sim/body';
import { makeVehicle, newId } from '../../sim/factory';
import { baseGrid, isMounted, itemCells, mountSpots, MOUNT_CELLS } from '../../sim/grid';
import { generateNpcLoadout } from '../../sim/npc-loadout';
import { emptyWorld } from '../../sim/testkit';
import type { GridItem, Vehicle, World } from '../../sim/types';
import { loadModels, model, socket } from './models';
import { footprint, VehicleView, wouldFloat } from './vehicle';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

const SLOW = 600_000; // ms: each case builds many truck views
const TOLERANCE = 0.01; // meters a head may cut into an obstacle
type Box = { x0: number; x1: number; z0: number; z1: number; top: number; what: string };

function headVertices(gun: Extract<GridItem, { kind: 'part' }>): THREE.Vector3[] {
  const look = weaponLook(gun.part.id, gun.part.defId);
  const out: THREE.Vector3[] = [];
  const add = (name: Parameters<typeof model>[0], off: THREE.Vector3) => {
    const obj = model(name);
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const p = o.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).add(off));
    });
  };
  add(look.receiver, new THREE.Vector3());
  add(look.barrel, socket(look.receiver, 'muzzle'));
  if (look.extra) add(look.extra, socket(look.receiver, 'extra'));
  return out;
}

// Boxes of the drawn items a head can hit: no weapons, no body parts, no armor, engines or mounted wheels.
function obstacles(v: Vehicle, skip: GridItem): Box[] {
  const g = baseGrid(v.chassisId);
  const out: Box[] = [];
  for (const it of v.items) {
    if (it === skip || itemCells(it).some((c) => c.y >= g.h)) continue;
    let what: string = it.kind === 'good' ? it.good : it.part.defId;
    if (it.kind === 'part') {
      const d = partDef(it.part.defId);
      if (BODY_PARTS.has(d.id) || d.kind === 'weapon' || d.kind === 'armor' || d.kind === 'engine') continue;
      if (d.kind === 'core' && (isMounted(v.chassisId, it) || d.role !== 'tank')) continue;
      if (/wheel/i.test(d.id) && isMounted(v.chassisId, it)) continue;
      what = d.id;
    }
    if (wouldFloat(v, it)) continue;
    const rest = restOn(v.chassisId, cellRect(v.chassisId, itemCells(it)));
    // The model's own box, stretched and turned to its footprint: a model need not fill its cells.
    const at = footprint(v, it, rest.y);
    const box = new THREE.Box3().setFromObject(model(partModel(what))).applyMatrix4(new THREE.Matrix4().compose(at.pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, at.yaw, 0)), at.scale));
    out.push({ x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z, top: box.max.y, what });
  }
  return out;
}

// Every clip of every gun's head on the vehicle, as readable lines.
function clips(world: World, v: Vehicle): string[] {
  const view = new VehicleView(v, true);
  const problems: string[] = [];
  for (const gun of v.items.filter((it): it is Extract<GridItem, { kind: 'part' }> => it.kind === 'part' && partDef(it.part.defId).kind === 'weapon')) {
    if (itemCells(gun).some((c) => c.y >= baseGrid(v.chassisId).h)) continue; // a cargo row gun is not drawn
    const pivot = view.partPoint(gun.part.id);
    const pts = headVertices(gun);
    const spans = isMounted(v.chassisId, gun) ? gunSpans(v, gun) : [];
    const boxes = obstacles(v, gun);
    const own = cellRect(v.chassisId, itemCells(gun));
    const yaws = Array.from({ length: 360 }, (_, i) => i - 180).filter((a) => spans.length > 0 && aimWithin(spans, a) === a);
    if (yaws.length === 0) yaws.push(0);
    let worst = 0;
    let where = '';
    for (const a of yaws) {
      const r = (a * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      for (const p of pts) {
        if (Math.hypot(p.x, p.z) < 0.25) continue;
        const x = pivot.x + p.x * c - p.z * s;
        const z = pivot.z + p.x * s + p.z * c;
        const y = pivot.y + p.y;
        for (const b of boxes) {
          if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.top - y > worst) { worst = b.top - y; where = `${b.what} at yaw ${a}`; }
        }
        // The body is a 10 cm height map and a sample whose center lies in the gun's own footprint belongs to the gun.
        const cell = surfaceSamples(v.chassisId, { x, z }, 0.08).find((c) => Math.abs(c.x - x) <= c.half && Math.abs(c.z - z) <= c.half);
        if (cell && cell.x >= own.x0 && cell.x <= own.x1 && cell.z >= own.z0 && cell.z <= own.z1) continue;
        const surface = highestUnder(v.chassisId, { x0: x - 0.02, x1: x + 0.02, z0: z - 0.02, z1: z + 0.02 });
        if (surface - y > worst) { worst = surface - y; where = `body at yaw ${a}`; }
      }
    }
    if (worst > TOLERANCE) problems.push(`${v.chassisId} ${gun.part.defId}@${gun.x},${gun.y} cuts ${worst.toFixed(2)} m into ${where}`);
  }
  void world;
  return problems;
}

function place(world: World, v: Vehicle, defId: string | null, good: string | null, x: number, y: number, rot: 0 | 1): boolean {
  const item = (defId
    ? { id: newId(world, 'i'), kind: 'part', x, y, rot, part: { id: newId(world, 'p'), defId, hp: 1, wear: 0, ...(partDef(defId).kind === 'weapon' ? { gun: { cooldown: 0, ammo: 1, reloadWork: 0 } } : {}) } }
    : { id: newId(world, 'i'), kind: 'good', x, y, rot, good }) as GridItem;
  const g = baseGrid(v.chassisId);
  const cells = itemCells(item);
  const free = cells.every((c) => g.cells[c.y]?.[c.x] && !v.items.some((o) => itemCells(o).some((k) => k.x === c.x && k.y === c.y)));
  if (!free) return false;
  v.items.push(item);
  return true;
}

function bare(chassisId: string): { world: World; v: Vehicle } {
  const world = emptyWorld();
  const v = makeVehicle(world, { name: chassisId, faction: 'player', chassisId, parts: [], spares: [], cargo: {}, pos: { x: 50, y: 50 }, heading: 0, brain: null });
  return { world, v };
}

// Fills every free plain or deck cell with the tallest good, so a head has something to cut at each cell.
function fill(world: World, v: Vehicle): void {
  const g = baseGrid(v.chassisId);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.cells[y][x] === '.' || g.cells[y][x] === 'D') place(world, v, null, 'electronics', x, y, 0);
}

describe('gun heads clear what they sweep over', () => {
  it.each(Object.keys(CHASSIS))('%s: a gun on a deck spot among tall goods', (id) => {
    const problems: string[] = [];
    for (const gunId of ['mg', 'amRifle']) {
      for (const rot of [0, 1] as const) {
        const { world, v } = bare(id);
        const g = baseGrid(id);
        const probe = { id: 'probe', kind: 'part', x: 0, y: 0, rot, part: { id: 'probe', defId: gunId, hp: 1, wear: 0 } } as GridItem;
        const spots = mountSpots(g, v.items, probe, MOUNT_CELLS.weapon).filter((s) => s.rot === rot);
        const step = Math.max(1, Math.floor(spots.length / 4));
        for (let i = 0; i < spots.length; i += step) {
          const t = bare(id);
          if (!place(t.world, t.v, gunId, null, spots[i].x, spots[i].y, rot)) continue;
          fill(t.world, t.v);
          problems.push(...clips(t.world, t.v));
        }
        void world;
      }
    }
    expect(problems).toEqual([]);
  }, SLOW);

  it('NPC loadouts of every template', () => {
    const problems: string[] = [];
    for (const t of Object.values(NPCS)) {
      for (let seed = 1; seed <= 4; seed++) {
        const world = { ...emptyWorld(), rngState: seed * 7 + 3 };
        let v: Vehicle;
        try {
          const l = generateNpcLoadout(world, t, null, 'loaded');
          v = makeVehicle(world, { ...l, name: 'x', faction: t.faction, brain: null, pos: { x: 50, y: 50 }, heading: 0 });
        } catch {
          continue;
        }
        problems.push(...clips(world, v).map((p) => `${t.id}#${seed} ${p}`));
      }
    }
    expect(problems).toEqual([]);
  }, SLOW);

  it('the scout pickup layout of the player screenshot', () => {
    const { world, v } = bare('scout');
    const g = baseGrid('scout');
    const deck: [number, number][] = [];
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.cells[y][x] === 'D') deck.push([x, y]);
    const mgs = [deck[0], deck[Math.floor(deck.length / 2)], deck[deck.length - 1]];
    for (const [x, y] of mgs) place(world, v, 'mg', null, x, y, 0);
    place(world, v, 'panniers', null, 0, 0, 0);
    fill(world, v);
    expect(clips(world, v)).toEqual([]);
  });

  it('the gunwagon layout of the committee screenshot', () => {
    const { world, v } = bare('wagon');
    const g = baseGrid('wagon');
    const deck: [number, number][] = [];
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.cells[y][x] === 'D') deck.push([x, y]);
    for (const i of [0, Math.floor(deck.length / 3), Math.floor((2 * deck.length) / 3), deck.length - 1]) place(world, v, 'mg', null, deck[i][0], deck[i][1], 0);
    fill(world, v);
    expect(clips(world, v)).toEqual([]);
  });
});
