// Engine heat: the sun heats the player's running engine, and shade, night and parking cool it.
// Overdrive heats a driving engine in any sun. An overheated engine loses HP every turn it keeps driving. Player only: NPC drivers have no rule
// for stopping to cool down, so the heat would only break their engines.

import { partDef, type EngineDef } from '../data/parts';
import { RULES } from '../data/rules';
import { TIME } from '../data/time';
import { ENGINE_HEAT } from '../data/wear';
import { PERK_NUMBERS } from '../data/skills';
import { damagePart } from './wear';
import { playerVehicle } from './damage';
import { mountedParts } from './grid';
import { practice, regionOf, skillEffect, vehicleHasPerk } from './progress';
import { inOverdrive, vehicleStats } from './stats';
import { cappedHeatAt, heatAt } from './sun';
import type { PartInstance, Vehicle, World } from './types';
import { isShutDown } from './utility';
import { playerCommand } from './world';

function enginePulls(world: World, me: Vehicle): boolean {
  return me.speed > RULES.parkedSpeed && !isShutDown(world, me);
}

export function advanceEngineHeat(world: World): void {
  const me = playerVehicle(world);
  const sunHeat = heatAt(world, me.pos);
  const heat = engineSunHeat(world, me, sunHeat);
  const before = world.player.engineHeat;
  let next: number;
  if (enginePulls(world, me)) {
    const share = Math.min(1, me.speed / vehicleStats(world, me).maxSpeed);
    const rate = engineHeatMult(me) * (1 - skillEffect(world, me, 'machining', 'engineHeat'));
    next = before + rate * (ENGINE_HEAT.gain * (heat - 1) * share + overdriveGain(world, me) - ENGINE_HEAT.coolDriving);
  } else {
    next = before - ENGINE_HEAT.coolParked / heat;
  }
  world.player.engineHeat = Math.min(1, Math.max(0, next));
  practiceHeat(world, me.speed, sunHeat);

  if (before < ENGINE_HEAT.warnAt && world.player.engineHeat >= ENGINE_HEAT.warnAt) {
    world.events.push({ t: 'info', text: 'Engine running hot.' });
  }
  if (!engineOverheating(world)) return;
  for (const e of heatedEngines(me)) damagePart(e, ENGINE_HEAT.overheatDamage, 0);
  world.events.push({ t: 'info', text: `Engine overheated: engine -${ENGINE_HEAT.overheatDamage} HP` });
}

export function engineOverheating(world: World): boolean {
  const me = playerVehicle(world);
  return world.player.engineHeat >= 1 && enginePulls(world, me) && heatedEngines(me).length > 0;
}

function heatedEngines(v: Vehicle): PartInstance[] {
  return mountedParts(v).filter((p) => partDef(p.defId).kind === 'engine' && p.hp > 0);
}

export function douseBlock(world: World): string | null {
  if (world.player.supplies < ENGINE_HEAT.douseSupplies) return `Need ${ENGINE_HEAT.douseSupplies} supplies`;
  if (world.player.engineHeat <= 0) return 'Engine is cool';
  return null;
}

export function canDouse(world: World): boolean {
  return douseBlock(world) === null;
}

export function douseEngine(world: World): World {
  return playerCommand(world, (w) => {
    if (!canDouse(w)) throw new Error('Cannot douse: needs supplies and a warm engine');
    w.player.supplies -= ENGINE_HEAT.douseSupplies;
    w.player.engineHeat = Math.max(0, w.player.engineHeat - ENGINE_HEAT.douseCool);
    w.events.push({ t: 'supply', what: 'supplies', text: `Doused the engine: supplies -${ENGINE_HEAT.douseSupplies}` });
  });
}

function practiceHeat(world: World, speed: number, heat: number): void {
  if (speed <= RULES.parkedSpeed || heat <= 1) return;
  practice(world, 'heat', 1, Math.min(1, (heat - 1) / (TIME.sunHeat - 1)), regionOf(playerVehicle(world).pos));
}

function engineSunHeat(world: World, me: Vehicle, sunHeat: number): number {
  return vehicleHasPerk(world, me, 'desertRat') ? cappedHeatAt(world, me.pos, PERK_NUMBERS.desertRat.sunShare) : sunHeat;
}

function overdriveGain(world: World, v: Vehicle): number {
  return inOverdrive(world, v) ? ENGINE_HEAT.overdriveGain : 0;
}

function engineHeatMult(v: Vehicle): number {
  const engine = mountedParts(v, 'engine')[0];
  return engine ? (partDef(engine.defId) as EngineDef).heat : 0;
}
