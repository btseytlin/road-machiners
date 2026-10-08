// Stuck soak: plays a whole world of NPCs on the real map through the turn pipeline for many turns and collects every
// stall the watchdog logged and any error. A stall means some rule left a driver with no way forward, so a clean run
// has none. See watchStalls() in src/sim/npc-activities.ts. Every truck moves as it does beyond the player's sight,

import { START_KITS } from '../data/start';
import { isHostile } from '../sim/combat';
import { hangUp } from '../sim/dialogue';
import { advanceFar } from '../sim/far';
import { canVehicleSee } from '../sim/vision';
import { freeCells, goodsCount, mountedParts } from '../sim/grid';
import { getResources } from '../sim/resources';
import { isStranded } from '../sim/stats';
import type { GameEvent, NpcActivity, Vehicle, World } from '../sim/types';
import { dist } from '../sim/vec';
import { endTurn, newWorld } from '../sim/world';
import { TEST_MAP } from './map';

export type SoakReport = { seed: number; turns: number; stalls: string[]; error: string | null };

export function soak(seed: number, turns: number): SoakReport {
  let w = newWorld(seed, START_KITS.standard, TEST_MAP);
  w.player.god = true;
  const stalls: string[] = [];
  let played = 0;
  try {
    for (; played < turns; played++) {
      if (w.player.call) w = hangUp(w);
      const before = topGoals(w);
      w = endTurn(w, moveAllFar);
      for (const e of w.events) if (e.t === 'stall') stalls.push(describeStall(w, e, before.get(e.vehicle)));
    }
  } catch (err) {
    return { seed, turns: played, stalls, error: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  }
  return { seed, turns: played, stalls, error: null };
}

function moveAllFar(w: World): void {
  for (const v of w.vehicles) advanceFar(w, v);
}

function topGoals(w: World): Map<string, NpcActivity> {
  const tops = new Map<string, NpcActivity>();
  for (const v of w.vehicles) {
    const top = v.brain?.goals.at(-1);
    if (top) tops.set(v.id, structuredClone(top));
  }
  return tops;
}

function describeStall(w: World, e: Extract<GameEvent, { t: 'stall' }>, goal: NpcActivity | undefined): string {
  const v = w.vehicles.find((x) => x.id === e.vehicle);
  const at = `turn ${w.turn}: ${e.vehicle} gave up ${e.goal ?? 'idle'} (${e.reason})`;
  if (!v) return at;
  const dest = goal?.destination ? ` toward ${Math.round(goal.destination.x)},${Math.round(goal.destination.y)}, ${Math.round(dist(v.pos, goal.destination))} tiles off, target ${goal.targetId}, phase ${goal.phase}` : '';
  return `${at}${dest}\n  ${vehicleLine(w, v)} free cells ${freeCells(v)}\n  ${surroundings(w, v)}`;
}

function surroundings(w: World, v: Vehicle): string {
  const near = w.vehicles.filter((o) => o.id !== v.id && dist(o.pos, v.pos) < 6)
    .map((o) => `${o.id}:${o.brain?.templateId ?? 'player'}@${Math.round(dist(o.pos, v.pos))} top ${o.brain?.goals.at(-1)?.kind ?? '-'}`);
  const hostiles = w.vehicles.filter((o) => isHostile(w, v, o) && canVehicleSee(w, v, o.pos)).map((o) => `${o.id}@${Math.round(dist(o.pos, v.pos))}`);
  return `order ${JSON.stringify(v.order)} far route ${v.brain!.farRoute?.points.length ?? '-'} near ${near.join(', ') || 'none'} hostiles ${hostiles.join(', ') || 'none'}`;
}

function vehicleLine(w: World, v: Vehicle): string {
  const r = getResources(w, v);
  const goals = v.brain!.goals.map((g) => `${g.kind}:${g.reason}`).join(' > ') || 'none';
  const states = w.states.filter((s) => s.holder === v.id || s.other === v.id).map((s) => `${s.kind}${s.holder === v.id ? '>' : '<'}`).join(',') || 'none';
  return `${v.brain!.templateId} ${v.chassisId} at ${Math.round(v.pos.x)},${Math.round(v.pos.y)} speed ${v.speed.toFixed(2)} stranded ${isStranded(w, v)} `
    + `money ${r.money} fuel ${r.fuel.toFixed(0)} engines ${mountedParts(v, 'engine').length} job ${v.job?.kind ?? '-'} `
    + `goals now ${goals} states ${states} goods ${JSON.stringify(goodsCount(v))}`;
}

export function formatSoak(reports: SoakReport[]): string {
  return reports.map((r) => {
    const head = `seed ${r.seed}: ${r.turns} turns, ${r.stalls.length} stalls${r.error ? ', ERROR' : ''}`;
    return [head, ...r.stalls, ...(r.error ? [r.error] : [])].join('\n');
  }).join('\n\n');
}
