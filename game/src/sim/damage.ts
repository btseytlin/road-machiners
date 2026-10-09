// Applying damage. Hit points clamp at zero. Damage reaches parts only through walkLane in armor.ts.

import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import * as wear from "./wear";
import { practice, skillEffect, vehicleHasPerk } from "./progress";
import { corePart, mountedParts } from "./grid";
import type { PartInstance, Vehicle, World } from "./types";

export function damagePart(
  world: World,
  v: Vehicle,
  part: PartInstance,
  amount: number,
): number {
  const wasWorking = part.hp > 0;
  const dealt = Math.min(part.hp, wholeDamage(amount));
  wear.damagePart(part, dealt, 0);
  if (wasWorking && part.hp === 0)
    world.events.push({ t: "partDisabled", vehicle: v.id, part: part.id });
  if (hurtsDriver(world, v, part)) hurtDriver(world, v, dealt);
  return dealt;
}

export function wholeDamage(amount: number): number {
  return Math.max(0, Math.round(amount));
}

function hurtsDriver(world: World, v: Vehicle, part: PartInstance): boolean {
  if (v.id !== world.player.vehicleId) return false;
  const def = partDef(part.defId);
  if (def.kind === "core" && def.role === "cab") return true;
  return corePart(v, "cab").hp === 0 && vehicleHasPerk(world, v, "fightThrough");
}

function hurtDriver(world: World, v: Vehicle, dealt: number): void {
  const health = world.player.health;
  const share = RULES.cabHealthShare * (1 - skillEffect(world, v, "toughness", "cabShare"));
  world.player.health = Math.max(0, health - Math.round(dealt * share));
  if (world.player.health < health) practice(world, "damage", health - world.player.health, null, "driver");
}

export function findPart(v: Vehicle, partId: string): PartInstance | null {
  return mountedParts(v).find((p) => p.id === partId) ?? null;
}

export function vehicleById(world: World, id: string): Vehicle {
  const v = world.vehicles.find((x) => x.id === id);
  if (!v) throw new Error(`No vehicle ${id}`);
  return v;
}

export function playerVehicle(world: World): Vehicle {
  return vehicleById(world, world.player.vehicleId);
}
