// Engine heat: the sun heats the player's running engine, and shade, night and parking cool it.
// Overdrive heats a driving engine in any sun. An overheated engine loses HP every turn it keeps driving. Player only: NPC drivers have no rule
// for stopping to cool down, so the heat would only break their engines.

import { partDef, type EngineDef } from '../data/parts';
import { RULES } from '../data/rules';
import { TIME } from '../data/time';
import { ENGINE_HEAT } from '../data/wear';
import { PERK_NUMBERS } from '../data/skills';
import { damagePart, wornDef } from './wear';
import { playerVehicle } from './damage';
import { mountedParts } from './grid';
import { practice, regionOf, skillEffect, vehicleHasPerk } from './progress';
import { inOverdrive, vehicleStats } from './stats';
import { cappedHeatAt, heatAt } from './sun';
import type { PartInstance, Vehicle, World } from './types';
import { playerCommand } from './world';

export function advanceEngineHeat(world: World): void {
  const me = playerVehicle(world);
  const sunHeat = heatAt(world, me.pos);
  const heat = engineSunHeat(world, me, sunHeat);
  const before = world.player.engineHeat;
  let next: number;
  if (me.speed > RULES.parkedSpeed) {
    const share = Math.min(1, me.speed / vehicleStats(world, me).maxSpeed);
    // The engine and skill scale airflow cooling as much as sun heating, so every engine starts heating at the
    // same sun heat, where the ground shimmers, and differs only in how fast.
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

// Whether heat costs the player's engine HP this turn: full heat, driving, and a working engine to damage.
export function engineOverheating(world: World): boolean {
  const me = playerVehicle(world);
  return world.player.engineHeat >= 1 && me.speed > RULES.parkedSpeed && heatedEngines(me).length > 0;
}

// The mounted engines that heat can still damage.
function heatedEngines(v: Vehicle): PartInstance[] {
  return mountedParts(v).filter((p) => partDef(p.defId).kind === 'engine' && p.hp > 0);
}

// Whether dousing would help: enough supplies and a warm engine.
export function canDouse(world: World): boolean {
  return world.player.supplies >= ENGINE_HEAT.douseSupplies && world.player.engineHeat > 0;
}

// The player pours water from the supplies over the engine, which cools it at once.
export function douseEngine(world: World): World {
  return playerCommand(world, (w) => {
    if (!canDouse(w)) throw new Error('Cannot douse: needs supplies and a warm engine');
    w.player.supplies -= ENGINE_HEAT.douseSupplies;
    w.player.engineHeat = Math.max(0, w.player.engineHeat - ENGINE_HEAT.douseCool);
    w.events.push({ t: 'supply', what: 'supplies', text: `Doused the engine: supplies -${ENGINE_HEAT.douseSupplies}` });
  });
}

// The player practices toughness each turn it drives in heat above shade, harder toward full noon sun. A heat wave
// can pass full noon sun and counts as the hardest.
function practiceHeat(world: World, speed: number, heat: number): void {
  if (speed <= RULES.parkedSpeed || heat <= 1) return;
  practice(world, 'heat', 1, Math.min(1, (heat - 1) / (TIME.sunHeat - 1)), regionOf(playerVehicle(world).pos));
}

// The sun heat the engine feels. The Desert rat perk caps the sun height, while practice still reads the real heat.
function engineSunHeat(world: World, me: Vehicle, sunHeat: number): number {
  return vehicleHasPerk(world, me, 'desertRat') ? cappedHeatAt(world, me.pos, PERK_NUMBERS.desertRat.sunShare) : sunHeat;
}

function overdriveGain(world: World, v: Vehicle): number {
  return inOverdrive(world, v) ? ENGINE_HEAT.overdriveGain : 0;
}

// How fast the sun heats the mounted engine. A truck with no engine has nothing to heat.
function engineHeatMult(v: Vehicle): number {
  const engine = mountedParts(v, 'engine')[0];
  return engine ? wornDef<EngineDef>(engine).heat : 0;
}
