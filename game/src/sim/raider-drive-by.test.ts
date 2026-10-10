// Drive-by ambush scenarios on the real map, through the turn pipeline. A scrapjaw raider watches at the hide of a road
// ground while prey drives the road past it. Each turn is traced, and the trace prints in an assertion message.
import { describe, expect, it } from 'vitest';
import { HUNT } from '../data/npcs';
import { REGION } from '../data/region';
import { START_KITS } from '../data/start';
import { TEST_MAP } from '../test/map';
import { goodsCount, isLoot } from './grid';
import { addGoods } from './inventory';
import { isTransientWreck } from './nav/layer';
import { huntingGrounds } from './npc-decisions';
import { sitePads } from './sites';
import { defaultSetup } from './settings';
import { sunAt } from './sun';
import { stateOf } from './states';
import { addVehicle, npcBrain, testDrive } from './testkit';
import type { Vehicle, World } from './types';
import { dist, polylineDist, type Vec } from './vec';
import { exposureAt, watchPost } from './watch-posts';
import { endTurn, newWorld } from './world';
import { formatNpcPass } from '../ui/format';
import { resolve } from '../text/resolve';
import { playerVehicle } from './damage';
import { canVehicleSee } from './vision';
import { contactsOf } from './detect';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const camp = REGION.locations.find((l) => l.id === 'scrapjaw')!;
const TURNS = 40;

type Prey = 'trader' | 'player' | 'playerEmpty' | 'empty' | 'parked' | 'brute';

function nightTurn(): number {
  for (let t = 1; t < 2000; t++) if (sunAt(t) === null) return t;
  throw new Error('No night turn');
}

function roadGround(w: World): { ground: Vec; post: Vec; a: Vec; dir: Vec } {
  const grounds = [...huntingGrounds()].sort((a, b) => dist(a, camp.pos) - dist(b, camp.pos));
  for (const ground of grounds) {
    const road = REGION.roads.find((r) => polylineDist(ground, r) <= REGION.roadWidth);
    const post = watchPost(w, ground);
    if (!road || !post || exposureAt(w, post) > 0) continue;
    let best = { d: Infinity, a: road[0], b: road[1] };
    for (let i = 0; i + 1 < road.length; i++) {
      const mid = { x: (road[i].x + road[i + 1].x) / 2, y: (road[i].y + road[i + 1].y) / 2 };
      if (dist(mid, ground) < best.d) best = { d: dist(mid, ground), a: road[i], b: road[i + 1] };
    }
    const len = dist(best.a, best.b);
    return { ground, post, a: ground, dir: { x: (best.b.x - best.a.x) / len, y: (best.b.y - best.a.y) / len } };
  }
  throw new Error('No road ground with a hide');
}

type Scene = { w: World; raider: Vehicle; prey: Vehicle; ground: Vec; end: Vec; moves: boolean; parkedAt: Vec };

function scene(seed: number, kind: Prey, night: boolean): Scene {
  const w = newWorld(seed, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
  w.obstacles = w.obstacles.filter((o) => !isTransientWreck(o));
  if (night) w.turn = nightTurn();
  const { ground, post, dir } = roadGround(w);
  const me = playerVehicle(w);
  const at = (along: number): Vec => ({ x: ground.x + dir.x * along, y: ground.y + dir.y * along });
  const start = kind === 'parked' ? { x: post.x + (post.x > w.size / 2 ? -60 : 60), y: post.y } : at(-45);
  const others = w.vehicles.filter((v) => v.id !== me.id);
  w.vehicles = w.vehicles.filter((v) => v.id === me.id);
  w.removed.push(...others);
  const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { ...post });
  raider.brain = npcBrain('buggy', sitePads(camp)[0], ['raider']);
  raider.brain.goals = [{ kind: 'raid', targetId: null, destination: null, phase: 'act', reason: 'watchedRoad', watchUntil: w.turn + HUNT.watchTurns }];
  const end = at(60);
  let prey: Vehicle;
  if (kind === 'player' || kind === 'playerEmpty') {
    prey = me;
    if (kind === 'playerEmpty') me.items = me.items.filter((item) => !isLoot(me.chassisId, item));
    prey.pos = { ...start };
  } else {
    me.items = me.items.filter((item) => !isLoot(me.chassisId, item));
    me.pos = { x: post.x + 3, y: post.y + 3 };
    prey = addVehicle(w, 'traders', kind === 'brute' ? 'hauler' : 'scout', kind === 'brute' ? ['mg', 'mg', 'mg', 'mg', 'stockEngine'] : ['mg', 'stockEngine'], { ...start });
    prey.brain = npcBrain('trader', prey.pos, ['trader']);
    prey.brain.goals = [];
    if (kind === 'empty') prey.items = prey.items.filter((item) => !isLoot(prey.chassisId, item));
    if (kind !== 'empty' && kind !== 'parked') addGoods(w, prey, 'electronics', 6);
    if (kind === 'brute') addGoods(w, prey, 'electronics', 6);
    if (kind !== 'empty' && kind !== 'parked' && goodsCount(prey).electronics === undefined) throw new Error('The prey holds no cargo');
  }
  if (kind === 'parked') prey.pos = { ...start };
  return { w, raider, prey, ground, end, moves: kind !== 'parked', parkedAt: { ...prey.pos } };
}

type Frame = { turn: number; raider: Vec; prey: Vec; sees: boolean; heard: string; goals: string[]; cargo: number };
type Result = { hover: string[]; engaged: boolean; passed: string[]; frames: Frame[]; goalsChanged: boolean; feud: boolean; fled: boolean };

function play(s: Scene, turns = TURNS): Result {
  let w = s.w;
  const frames: Frame[] = [];
  const passed: string[] = [];
  const hover = new Set<string>();
  let engaged = false, goalsChanged = false, feud = false, fled = false;
  for (let i = 0; i < turns; i++) {
    if (w.player.call) {
      if (w.player.call.with === s.raider.id) engaged = true;
      w.player.call = null;
    }
    if (engaged) break;
    w = endTurn(w, (world) => {
      const mover = world.vehicles.find((v) => v.id === s.prey.id)!;
      if (s.moves) mover.order = { kind: 'stopAt', dest: s.end };
      else {
        mover.order = null;
        mover.speed = 0;
      }
      testDrive(world);
    });
    const raider = w.vehicles.find((v) => v.id === s.raider.id)!;
    const prey = w.vehicles.find((v) => v.id === s.prey.id)!;
    if (!s.moves) {
      prey.pos = { ...s.parkedAt };
      prey.speed = 0;
      prey.order = null;
    }
    const goals = raider.brain!.goals;
    if (goals.some((g) => g.kind === 'fight' && g.targetId === prey.id) || stateOf(w, 'combat', raider.id, prey.id) !== null) engaged = true;
    if (goals.some((g) => g.kind === 'flee' && g.targetId === prey.id)) fled = true;
    if (stateOf(w, 'feud', raider.id, prey.id) !== null || stateOf(w, 'feud', prey.id, raider.id) !== null) feud = true;
    if (goals.some((g) => g.targetId === prey.id)) goalsChanged = true;
    for (const e of w.events) if (e.t === 'preyPassed' && e.vehicle === raider.id) passed.push(e.reason);
    const line = formatNpcPass(w, raider);
    if (line) hover.add(resolve(line, 'en'));
    const contact = contactsOf(w, raider, Infinity).find((c) => c.vehicleId === prey.id);
    frames.push({
      turn: w.turn,
      raider: { x: Math.round(raider.pos.x), y: Math.round(raider.pos.y) },
      prey: { x: Math.round(prey.pos.x), y: Math.round(prey.pos.y) },
      sees: canVehicleSee(w, raider, prey.pos),
      heard: contact ? `${Math.round(contact.center.x)},${Math.round(contact.center.y)} r${contact.radius.toFixed(0)}` : '-',
      goals: goals.map((g) => g.kind),
      cargo: prey.items.length,
    });
    if (engaged) break;
  }
  return { hover: [...hover], engaged, passed, frames, goalsChanged, feud, fled };
}


const trace = (r: Result): string => r.frames.map((f) => `${f.turn} R${f.raider.x},${f.raider.y} P${f.prey.x},${f.prey.y} ${f.sees ? 'SEES' : 'blind'} heard ${f.heard} [${f.goals.join('>')}]`).join('\n');

const memo = new Map<string, Result[]>();

function runs(kind: Prey, night: boolean, turns = TURNS): Result[] {
  const key = `${kind}:${night}:${turns}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const results = SEEDS.map((seed) => play(scene(seed, kind, night), turns));
  memo.set(key, results);
  return results;
}

function count(results: Result[], pick: (r: Result) => boolean): number {
  return results.filter(pick).length;
}

function summary(results: Result[]): string {
  return results.map((r, i) => `seed ${SEEDS[i]}: engaged ${r.engaged} passed ${r.passed.join('+') || '-'}\n${trace(r)}`).join('\n\n');
}

describe.each([['by day', false], ['at night', true]])('drive-by %s on the real map', (_label, night) => {
  const minTrader = night ? 4 : 6;

  it(`engages a trader carrying six electronics in at least ${minTrader} of 8 seeds`, () => {
    const results = runs('trader', night);
    expect(count(results, (r) => r.engaged), summary(results)).toBeGreaterThanOrEqual(minTrader);
  });

  it('engages the start-kit player or records why it let them pass, and leaves no feud with an empty-handed player', () => {
    const results = runs('player', night);
    expect(count(results, (r) => r.engaged || r.passed.length > 0), summary(results)).toBeGreaterThanOrEqual(6);
    if (night) expect(count(results, (r) => r.engaged), summary(results)).toBeGreaterThanOrEqual(1);
    const empty = runs('playerEmpty', night);
    expect(count(empty, (r) => r.engaged || r.feud), summary(empty)).toBe(0);
  });

  it('shows the pass line "nothing worth taking" when the raider sees an empty-handed player', () => {
    const empty = runs('playerEmpty', night);
    const shown = empty.flatMap((r) => r.hover);
    if (!night) expect(shown.length, summary(empty)).toBeGreaterThan(0);
    for (const line of shown) expect(line).toBe('Lets you pass: nothing worth taking');
  });

  it('never engages an empty trader', () => {
    const results = runs('empty', night);
    expect(count(results, (r) => r.engaged || r.feud), summary(results)).toBe(0);
  });

  it('changes no goal for prey parked beyond hearing and sight', () => {
    const results = runs('parked', night, 30);
    expect(count(results, (r) => r.goalsChanged), summary(results)).toBe(0);
  });

  it('flees or passes with outgunned from prey that outguns it', () => {
    const results = runs('brute', night);
    const wary = count(results, (r) => r.fled || r.passed.includes('outgunned'));
    expect(count(results, (r) => r.engaged), summary(results)).toBeLessThanOrEqual(3);
    expect(wary, summary(results)).toBeGreaterThanOrEqual(night ? 1 : 4);
  });
});
