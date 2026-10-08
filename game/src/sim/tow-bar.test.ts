import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { TOW } from '../data/tow';
import { bodyOf } from './body';
import { addVehicle, emptyWorld } from './testkit';
import { addState } from './states';
import { followTower } from './tow';
import type { Pose, Vehicle, World } from './types';
import { angleDiff, bearing, dist } from './vec';

const SUB = 26;
const axle = (id: string) => bodyOf(id).wheelX / PHYSICS.metersPerTile;
const rearOf = (p: Pose, a: number) => ({ x: p.x - Math.cos(p.heading) * a, y: p.y - Math.sin(p.heading) * a });

function hitchedPair(towedAt: { x: number; y: number }, towedHeading: number, towerChassis = 'hauler', towedChassis = 'hauler'): { w: World; tower: Vehicle; towed: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  const tower = addVehicle(w, 'traders', towerChassis, ['stockEngine'], { x: 30, y: 30 }, 0);
  const towed = addVehicle(w, 'traders', towedChassis, ['stockEngine'], towedAt, towedHeading);
  addState(w, 'tow', tower.id, towed.id, { kind: 'tow', site: 'bowl', fee: 0, waived: 0, hitched: true });
  return { w, tower, towed };
}

function trailFrom(at: (i: number) => { x: number; y: number }, heading: (i: number) => number): Pose[] {
  return Array.from({ length: SUB + 1 }, (_, i) => ({ ...at(i), heading: heading(i) }));
}

function drive(w: World, tower: Vehicle, towed: Vehicle, turns: Pose[][]): Pose[][] {
  const out: Pose[][] = [];
  for (const t of turns) {
    tower.trail = t;
    tower.pos = { x: t[t.length - 1].x, y: t[t.length - 1].y };
    followTower(w);
    out.push(towed.trail);
  }
  return out;
}

function straightTurns(n: number, step: number, from = 30): Pose[][] {
  return Array.from({ length: n }, (_, k) => trailFrom((i) => ({ x: from + (k * SUB + i) * step, y: 30 }), () => 0));
}

function bendTurns(): Pose[][] {
  const R = 6;
  const turns: Pose[][] = [];
  const pose = (s: number): Pose => {
    if (s <= 4) return { x: 30 + s, y: 30, heading: 0 };
    const a = (s - 4) / R;
    if (a <= Math.PI / 2) return { x: 34 + R * Math.sin(a), y: 30 + R * (1 - Math.cos(a)), heading: a };
    const rest = s - 4 - (R * Math.PI) / 2;
    return { x: 34 + R, y: 30 + R + rest, heading: Math.PI / 2 };
  };
  for (let k = 0; k < 6; k++) turns.push(Array.from({ length: SUB + 1 }, (_, i) => pose(((k * SUB + i) * 4) / SUB)));
  return turns;
}

describe('a hitched truck on a tow bar', () => {
  it('has a positive bar for every pair of chassis', () => {
    for (const a of Object.keys(CHASSIS)) for (const b of Object.keys(CHASSIS)) expect(TOW.gap - axle(a) - axle(b)).toBeGreaterThan(0);
  });

  it('converges to the gap on a straight, and never jumps', () => {
    const { w, tower, towed } = hitchedPair({ x: 26, y: 30.5 }, 0.3);
    const turns = drive(w, tower, towed, straightTurns(6, 4 / SUB));
    const hitchSteps = turns.flatMap((t, k) => t.map((p, i) => ({ p, k, i })));
    for (let n = 1; n < hitchSteps.length; n++) {
      if (hitchSteps[n].i === 0) continue;
      const prev = hitchSteps[n - 1].p;
      const cur = hitchSteps[n].p;
      expect(dist(prev, cur)).toBeLessThanOrEqual(TOW.takeUp * (4 / SUB) + 1e-9);
    }
    const end = turns[turns.length - 1][SUB];
    expect(dist(end, tower.pos)).toBeCloseTo(TOW.gap, 3);
    expect(Math.abs(angleDiff(end.heading, 0))).toBeLessThan(1e-2);
  });

  it('starts each turn where the last one ended', () => {
    const { w, tower, towed } = hitchedPair({ x: 28, y: 30 }, 0);
    const turns = drive(w, tower, towed, bendTurns());
    for (let k = 1; k < turns.length; k++) expect(turns[k][0]).toEqual(turns[k - 1][SUB]);
  });

  it('rolls on its rear axle through a bend, and stays within the gap', () => {
    const { w, tower, towed } = hitchedPair({ x: 28, y: 30 }, 0);
    const a = axle(towed.chassisId);
    const turns = drive(w, tower, towed, bendTurns());
    for (const t of turns) {
      for (let i = 1; i < t.length; i++) {
        const move = { x: rearOf(t[i], a).x - rearOf(t[i - 1], a).x, y: rearOf(t[i], a).y - rearOf(t[i - 1], a).y };
        const along = move.x * Math.cos(t[i].heading) + move.y * Math.sin(t[i].heading);
        const sideways = -move.x * Math.sin(t[i].heading) + move.y * Math.cos(t[i].heading);
        expect(Math.abs(sideways)).toBeLessThan(1e-9 + Math.abs(along) * 0.2);
      }
    }
    for (const t of turns) for (let i = 1; i < t.length; i++) expect(Math.abs(angleDiff(t[i].heading, t[i - 1].heading))).toBeLessThan(0.1);
    const end = turns[turns.length - 1][SUB];
    expect(dist(end, tower.pos)).toBeLessThanOrEqual(TOW.gap + 1e-6);
  });

  it('does not flip its heading when the tower backs up', () => {
    const { w, tower, towed } = hitchedPair({ x: 28, y: 30 }, 0);
    drive(w, tower, towed, straightTurns(3, 4 / SUB));
    const back = trailFrom((i) => ({ x: 30 + 3 * 4 - (i * 3) / SUB, y: 30 }), () => 0);
    const [t] = drive(w, tower, towed, [back]);
    for (let i = 1; i < t.length; i++) expect(Math.abs(angleDiff(t[i].heading, t[i - 1].heading))).toBeLessThan(0.05);
    expect(dist(t[SUB], tower.pos)).toBeLessThanOrEqual(TOW.gap + 1e-6);
  });

  it('keeps the heading as the bearing of its axles', () => {
    const { w, tower, towed } = hitchedPair({ x: 28, y: 30 }, 0);
    const [t] = drive(w, tower, towed, bendTurns().slice(1, 2));
    const a = axle(towed.chassisId);
    const end = t[SUB];
    const front = { x: end.x + Math.cos(end.heading) * a, y: end.y + Math.sin(end.heading) * a };
    expect(bearing(rearOf(end, a), front)).toBeCloseTo(end.heading, 9);
  });
});
