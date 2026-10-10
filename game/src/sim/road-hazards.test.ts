import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { HAZARDS, HIGHWAY, type SceneKind } from '../data/modes';
import { acrossOf, alongOf, fromRoad, highwayMap, WINDOW_SHIFT, milestoneAt, outpostFort, roadHeading, roadPoint, toRoad } from './highway';
import { boxDistance, mapObstacles, propBoxes, propObstacle, type PosedBox } from './mapgen';
import { CELL, componentOf, navLayer } from './nav/layer';
import { closurePieces, highwayDecks, lanesCoveredOf, leavesPassage, northClosureAt, scenesOf, southClosureAt, stretchLayout, type Scene } from './road-hazards';
import { sitePads, siteGap } from './sites';
import type { BakedMap, BakedProp } from './terrain';
import type { Vec } from './vec';
import type { RoadPiece } from './highway';

const SIZE = HIGHWAY.size;
const STRIDE = HIGHWAY.stride;
const ROAD = HIGHWAY.road;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const STRETCHES = Array.from({ length: 10 }, (_, i) => i + 1);

function baked(p: RoadPiece, window: number): BakedProp {
  return { kind: p.kind, pos: fromRoad(window, p.at.n, p.at.u), r: p.r, yaw: p.yaw, group: 0, step: 0, ...(p.hulk ? { hulk: p.hulk } : {}) };
}

function corners(b: PosedBox): Vec[] {
  return [-1, 1].flatMap((i) => [-1, 1].map((k) => ({
    x: b.center.x + b.axis.x * b.half.x * i - b.axis.y * b.half.y * k,
    y: b.center.y + b.axis.y * b.half.x * i + b.axis.x * b.half.y * k,
  })));
}

function acrossSpan(seed: number, window: number, p: RoadPiece): [number, number] {
  if (p.kind === 'rock' || p.kind === 'crag') {
    const d = acrossOf(seed, p.at);
    return [d - p.r, d + p.r];
  }
  const ds = propBoxes(propObstacle(baked(p, window), 0)).flatMap(corners).map((c) => acrossOf(seed, toRoad(window, c)));
  return [Math.min(...ds), Math.max(...ds)];
}

function boxesOf(p: RoadPiece, window: number): readonly PosedBox[] {
  return propBoxes(propObstacle(baked(p, window), 0));
}

function touch(a: RoadPiece, b: RoadPiece, window: number): boolean {
  const pa = fromRoad(window, a.at.n, a.at.u);
  const pb = fromRoad(window, b.at.n, b.at.u);
  if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > 8) return false;
  if (a.kind === 'rock' || a.kind === 'crag') return boxesOf(b, window).some((box) => boxDistance(box, pa) < a.r) || ((b.kind === 'rock' || b.kind === 'crag') && Math.hypot(pa.x - pb.x, pa.y - pb.y) < a.r + b.r);
  if (b.kind === 'rock' || b.kind === 'crag') return touch(b, a, window);
  const ba = boxesOf(a, window);
  const bb = boxesOf(b, window);
  return ba.some((x) => bb.some((y) => corners(x).some((c) => boxDistance(y, c) === 0) || corners(y).some((c) => boxDistance(x, c) === 0)));
}

function relYaw(seed: number, p: RoadPiece): number {
  const d = (((p.yaw - roadHeading(seed, p.at.n)) / (Math.PI / 180)) % 360 + 540) % 360 - 180;
  return d;
}

function allScenes(): { seed: number; j: number; scene: Scene }[] {
  return SEEDS.flatMap((seed) => STRETCHES.flatMap((j) => stretchLayout(seed, j).scenes.map((scene) => ({ seed, j, scene }))));
}

describe('a stretch layout', () => {
  it('builds the same layout every time', () => {
    expect(stretchLayout(4, 3)).toBe(stretchLayout(4, 3));
    expect(JSON.stringify(stretchLayout(4, 3))).toBe(JSON.stringify(stretchLayout(4, 3)));
  });

  it('alternates open arenas with scenes, between the clear road by each outpost', () => {
    for (const seed of SEEDS) {
      for (const j of STRETCHES) {
        const { arenas, scenes } = stretchLayout(seed, j);
        expect(scenes).toHaveLength(scenesOf(j));
        expect(arenas).toHaveLength(scenes.length + 1);
        expect(arenas[0].from).toBeCloseTo(milestoneAt(j - 1) + HAZARDS.clearAfterOutpost, 6);
        expect(arenas[arenas.length - 1].to).toBeCloseTo(milestoneAt(j) - HAZARDS.clearBeforeOutpost, 6);
        scenes.forEach((s, i) => {
          expect(arenas[i].to - arenas[i].from).toBeGreaterThanOrEqual(HAZARDS.arenaMin - 1e-9);
          expect(s.from).toBeCloseTo(arenas[i].to, 6);
          expect(arenas[i + 1].from).toBeCloseTo(s.to, 6);
        });
      }
    }
  });

  it('leaves every scene a way through on the road and keeps its pieces apart', () => {
    for (const { seed, j, scene } of allScenes()) {
      for (const row of scene.rows.filter((r) => r.length > 0)) {
        expect(leavesPassage(row.map((p) => acrossSpan(seed, j - 1, p))), `seed ${seed} stretch ${j} ${scene.kind}`).toBe(true);
      }
      const pieces = scene.rows.flat();
      pieces.forEach((a, i) => pieces.slice(i + 1).forEach((b) => expect(touch(a, b, j - 1), `seed ${seed} stretch ${j} ${scene.kind} ${a.kind} ${b.kind}`).toBe(false)));
    }
  });

  it('covers at most two lanes early on and three later, and never makes a ramp or a crater block', () => {
    for (const { seed, j, scene } of allScenes()) {
      if (scene.kind === 'rockfall' || scene.kind === 'checkpoint') continue;
      const onLanes = scene.rows.flat().filter((p) => p.kind !== 'tank' && Math.abs(acrossOf(seed, p.at)) <= ROAD.asphalt);
      const lanes = new Set(onLanes.flatMap((p) => {
        const [lo, hi] = acrossSpan(seed, j - 1, p);
        return ROAD.lanes.map((c, i) => [c, i] as const).filter(([c]) => hi > c - ROAD.laneWidth / 2 + 0.6 && lo < c + ROAD.laneWidth / 2 - 0.6).map(([, i]) => i);
      }));
      expect(lanes.size, `seed ${seed} stretch ${j} ${scene.kind}`).toBeLessThanOrEqual(lanesCoveredOf(j));
    }
  });

  it('turns every checkpoint barrier along its line and keeps scene vehicles at their recipe angles', () => {
    const near = (yaw: number, target: number, tol: number) => Math.min(Math.abs(yaw - target), Math.abs(yaw + target)) <= tol;
    for (const { seed, scene } of allScenes()) {
      const pieces = scene.rows.flat();
      if (scene.kind === 'checkpoint') for (const p of pieces.filter((x) => x.kind === 'barrier')) expect(near(relYaw(seed, p), 90, 5)).toBe(true);
      if (scene.kind === 'pileup') for (const p of pieces.filter((x) => x.hulk || x.kind === 'carWreck' || x.kind === 'deadTruck')) expect(Math.abs(relYaw(seed, p))).toBeGreaterThanOrEqual(HAZARDS.pileup.yaw[0] - 0.5);
      if (scene.kind === 'pileup') for (const p of pieces.filter((x) => x.hulk || x.kind === 'carWreck' || x.kind === 'deadTruck')) expect(Math.abs(relYaw(seed, p))).toBeLessThanOrEqual(HAZARDS.pileup.yaw[1] + 0.5);
      if (scene.kind === 'jackknife') {
        const hulk = pieces.find((p) => p.hulk)!;
        expect(['bus', 'hauler']).toContain(hulk.hulk);
        expect(Math.abs(relYaw(seed, hulk))).toBeGreaterThanOrEqual(HAZARDS.jackknife.yaw[0] - 0.5);
        for (const car of pieces.filter((p) => !p.hulk)) expect(Math.abs(relYaw(seed, car))).toBeLessThanOrEqual(HAZARDS.jackknife.carYaw + 0.5);
      }
    }
  });

  it('builds each scene from its recipe', () => {
    const seen = new Set<SceneKind>();
    for (const { scene } of allScenes()) {
      seen.add(scene.kind);
      const pieces = scene.rows.flat();
      const count = (kind: string) => pieces.filter((p) => p.kind === kind && !p.hulk).length;
      if (scene.kind === 'pileup') expect(pieces.filter((p) => p.hulk || p.kind === 'carWreck' || p.kind === 'deadTruck').length).toBeGreaterThanOrEqual(3);
      if (scene.kind === 'checkpoint') expect(scene.rows.length).toBeGreaterThanOrEqual(2);
      if (scene.kind === 'checkpoint') expect(count('barrier')).toBeGreaterThanOrEqual(8);
      if (scene.kind === 'tankline') expect([count('tank'), count('tankTrap') >= 6]).toEqual([1, true]);
      if (scene.kind === 'rockfall') expect([count('crag'), count('rock') >= 6]).toEqual([1, true]);
      if (scene.kind === 'craters') expect(scene.craters.length).toBeGreaterThanOrEqual(2);
      if (scene.kind === 'ramp') expect(scene.ramps).toHaveLength(1);
    }
    expect([...seen].sort()).toEqual(['checkpoint', 'craters', 'jackknife', 'pileup', 'ramp', 'rockfall', 'tankline']);
  });

  it('holds its scene count at the cap however far the run goes', () => {
    expect(scenesOf(1)).toBe(HAZARDS.scenes.first);
    expect(scenesOf(100)).toBe(HAZARDS.scenes.max);
    expect(stretchLayout(3, 60).scenes).toHaveLength(HAZARDS.scenes.max);
  });
});

function nCell(p: Vec): number {
  const n = Math.ceil(SIZE / CELL);
  return Math.floor(p.y / CELL) * n + Math.floor(p.x / CELL);
}

function inArena(seed: number, n: number): boolean {
  return STRETCHES.some((j) => stretchLayout(seed, j).arenas.some((a) => n >= a.from && n <= a.to));
}

describe('a highway window with its scenes', () => {
  it('holds nothing in an arena within the drivable corridor but poles and ditched cars', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      for (const k of [0, 1, 2]) {
        const map = highwayMap(seed, k);
        const stray = map.props.filter((p) => {
          const at = toRoad(k, p.pos);
          return inArena(seed, alongOf(seed, at)) && Math.abs(acrossOf(seed, at)) - p.r <= ROAD.verge && !['pole', 'carWreck', 'deadTruck'].includes(p.kind);
        });
        expect(stray.map((p) => p.kind), `seed ${seed} window ${k}`).toEqual([]);
        expect(map.props.filter((p) => p.hulk && inArena(seed, alongOf(seed, toRoad(k, p.pos))))).toEqual([]);
      }
    }
  });

  it('keeps every piece off the fort, its pad and its spur', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      for (const k of [0, 1]) {
        const map = highwayMap(seed, k);
        const fort = outpostFort(seed, k, k + 1);
        const loose = map.props.filter((p) => !p.kind.startsWith('fort'));
        expect(loose.filter((p) => siteGap(fort, p.pos) < p.r).map((p) => p.kind)).toEqual([]);
        expect(loose.filter((p) => map.terrain.types[Math.floor(p.pos.y) * SIZE + Math.floor(p.pos.x)] === 'concrete').map((p) => p.kind)).toEqual([]);
      }
    }
  });

  it('closes the road north of the unreached outpost and south of the window, so no route crosses either', () => {
    const smallest = Math.min(...Object.values(CHASSIS).map((c) => c.radius));
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const k of [0, 1, 2, 3]) {
        const map = highwayMap(seed, k);
        const layer = navLayer(map.terrain, mapObstacles(map), smallest);
        const pad = sitePads(outpostFort(seed, k, k + 1))[0];
        const beyond = roadPoint(seed, k, northClosureAt(k) + 12, ROAD.lanes[1]);
        const behind = roadPoint(seed, k, southClosureAt(k) - 10, ROAD.lanes[1]);
        const start = roadPoint(seed, k, milestoneAt(k) + 4, ROAD.lanes[1]);
        const inside = componentOf(layer, nCell(pad));
        expect(inside, `seed ${seed} window ${k}`).not.toBe(0);
        expect(componentOf(layer, nCell(start))).toBe(inside);
        expect(componentOf(layer, nCell(beyond)), `seed ${seed} window ${k} north`).not.toBe(inside);
        expect(componentOf(layer, nCell(behind)), `seed ${seed} window ${k} south`).not.toBe(inside);
      }
    }
  });

  it('lays the south closure a fixed way behind its milestone, on straight road and clear of the fort', () => {
    for (const k of [1, 2, 5]) {
      expect(southClosureAt(k)).toBe(milestoneAt(k) - HAZARDS.closures.south.behind);
      for (const seed of [1, 2, 3]) {
        const fort = outpostFort(seed, k, k);
        const wrecks = closurePieces(seed, k).filter((p) => Math.abs(p.at.n - southClosureAt(k)) < 5);
        expect(wrecks.length).toBeGreaterThan(0);
        expect(wrecks.every((p) => siteGap(fort, fromRoad(k, p.at.n, p.at.u)) > p.r), `seed ${seed} window ${k}`).toBe(true);
      }
    }
  });

  it('lays the closures from end-to-end barriers and burnt wrecks turned along their line', () => {
    const pieces = closurePieces(5, 2);
    const yaws = pieces.filter((p) => p.kind === 'barrier').map((p) => relYaw(5, p));
    expect(yaws.length).toBeGreaterThan(100);
    expect(yaws.every((y) => Math.abs(Math.abs(y) - 90) <= 5)).toBe(true);
    const wrecks = pieces.filter((p) => p.hulk || p.kind === 'carWreck' || p.kind === 'deadTruck');
    expect(wrecks.some((p) => p.hulk)).toBe(true);
    expect(wrecks.every((p) => Math.abs(Math.abs(relYaw(5, p)) - 90) <= HAZARDS.closures.south.yaw + 0.5)).toBe(true);
  });

  it('makes each hulk a lasting wreck obstacle of its chassis', () => {
    const map: BakedMap = highwayMap(2, 1);
    const hulks = mapObstacles(map).filter((o) => o.id.startsWith('hulk-'));
    expect(hulks.length).toBeGreaterThan(20);
    expect(hulks.every((o) => o.kind === 'wreck' && o.hulk !== undefined && o.hulk.chassisId in CHASSIS)).toBe(true);
    expect(() => propObstacle({ kind: 'deadTruck', pos: { x: 1, y: 1 }, r: 1, yaw: 0, group: 0, step: 0, hulk: 'nope' }, 0)).toThrow(/nope/);
  });

  it('builds a window with its scenes in good time', () => {
    const started = performance.now();
    highwayMap(13, 9);
    const ms = performance.now() - started;
    console.info(`highway window with scenes built in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  });
});

describe('a hull-plate ramp', () => {
  it('stands in one lane, rising north, with the rest of the road open', () => {
    for (const { seed, j, scene } of allScenes().filter((s) => s.scene.kind === 'ramp')) {
      const [ramp] = scene.ramps;
      expect(ramp.to.n).toBeGreaterThan(ramp.from.n);
      const d = acrossOf(seed, ramp.from);
      expect(leavesPassage([[d - ramp.width / 2, d + ramp.width / 2]]), `seed ${seed} stretch ${j}`).toBe(true);
    }
  });

  it('is the same deck in both windows that hold it', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      for (const k of [0, 1, 2]) {
        const shift = (spec: ReturnType<typeof highwayDecks>[number], by: number) => ({ ...spec, line: spec.line.map((s) => ({ at: { x: +(s.at.x + by * WINDOW_SHIFT.x / STRIDE).toFixed(6), y: +(s.at.y + by * WINDOW_SHIFT.y / STRIDE).toFixed(6) }, rise: s.rise })) });
        const inOverlap = (spec: ReturnType<typeof highwayDecks>[number], from: number, to: number) => spec.line.every((s) => s.at.y >= from && s.at.y <= to);
        const a = highwayDecks(seed, k).filter((s) => inOverlap(s, 0, SIZE - STRIDE)).map((s) => shift(s, 0));
        const b = highwayDecks(seed, k + 1).filter((s) => inOverlap(s, STRIDE, SIZE)).map((s) => shift(s, -STRIDE));
        expect(b).toEqual(a);
      }
    }
  });
});

describe('a stretch with its scenes turned off', () => {
  it('is one open arena', () => {
    const scenes = { ...HAZARDS.scenes };
    Object.assign(HAZARDS.scenes, { first: 0, max: 0 });
    try {
      const layout = stretchLayout(77, 3);
      expect(layout.scenes).toEqual([]);
      expect(layout.arenas).toHaveLength(1);
    } finally {
      Object.assign(HAZARDS.scenes, scenes);
    }
  });
});
