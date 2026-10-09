// NPC service at a site, and the lie-up for fresh gear. Service buys what the driver can pay for. A driver that only
// fresh gear can make fit then lies up at a site that serves it under a rearm goal. The goal ends early once the
// driver is fit again, else at its until turn with a fresh loadout from refitAtHome(). The wait is the template's

import { NPC_UPKEEP, NPCS } from '../data/npcs';
import { shopDef } from '../data/market';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { isDefeated, refitAtHome } from './defeat';
import { scrapFuel, serviceAtCamp, serviceAtStall, serviceVehicle } from './economy';
import { dropGoal, finishGoal, isBroke, noteShop, popGoal, pushGoal, reachSite, topGoal } from './npc-activities';
import { fitToHunt, getKnownSite, huntsPrey, npcProfile, type NpcProfile } from './npc-decisions';
import { getResources } from './resources';
import { canUseSite, type Site } from './sites';
import { isStranded, suppliesCap } from './stats';
import { isOnRope } from './tow';
import type { NpcActivity, Vehicle, World } from './types';

export function servingSiteIds(profile: NpcProfile): string[] {
  return profile.bases.length > 0 ? profile.bases : REGION.towns.map((t) => t.id);
}

export function serveStranded(world: World, vehicle: Vehicle, profile: NpcProfile): void {
  if (!parkedStranded(world, vehicle) || holdsRearm(vehicle)) return;
  const site = servingSiteIds(profile).map(getKnownSite).find((s) => canUseSite(vehicle.pos, s));
  if (!site) return;
  serviceAt(world, vehicle, site);
  scrapFuelIfBroke(world, vehicle, profile, site.id);
  if (isStranded(world, vehicle)) beginRearm(world, vehicle, site);
}

function parkedStranded(world: World, vehicle: Vehicle): boolean {
  return isStranded(world, vehicle) && !isOnRope(world, vehicle.id) && vehicle.speed <= RULES.parkedSpeed;
}

function scrapFuelIfBroke(world: World, vehicle: Vehicle, profile: NpcProfile, siteId: string): void {
  if (isBroke(world, vehicle) && servingSiteIds(profile).includes(siteId)) scrapFuel(world, vehicle);
}

export function resolveResupply(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  const site = reachSite(vehicle, activity);
  if (!site) return;
  noteShop(world, vehicle, site.id);
  const profile = npcProfile(vehicle);
  serviceAt(world, vehicle, site);
  scrapFuelIfBroke(world, vehicle, profile, site.id);
  if (needsFreshGear(world, vehicle) && servingSiteIds(profile).includes(site.id)) {
    popGoal(world, vehicle, 'finished service');
    beginRearm(world, vehicle, site);
  } else finishGoal(world, vehicle, 'finished service');
}

function serviceAt(world: World, vehicle: Vehicle, site: Site): void {
  const kind = 'kind' in site ? site.kind : null;
  if (kind === 'oasis') getResources(world, vehicle).supplies = suppliesCap(vehicle);
  else if (kind === 'camp') serviceAtCamp(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  else if (shopDef(site.id).kind === 'stall') serviceAtStall(world, vehicle, site.id, NPC_UPKEEP.repairParts);
  else serviceVehicle(world, vehicle, site.id, NPC_UPKEEP.repairParts);
}

function needsFreshGear(world: World, vehicle: Vehicle): boolean {
  return isDefeated(vehicle) || isStranded(world, vehicle) || (huntsPrey(vehicle) && !fitToHunt(world, vehicle));
}

export function holdsRearm(vehicle: Vehicle): boolean {
  return vehicle.brain!.goals.some((g) => g.kind === 'rearm');
}

function rearmTurns(vehicle: Vehicle): number {
  const template = NPCS[vehicle.brain!.templateId];
  if (!template) throw new Error(`${vehicle.id} has unknown template ${vehicle.brain!.templateId}`);
  return template.cap * template.interval;
}

export function beginRearm(world: World, vehicle: Vehicle, site: Site): void {
  if (!servingSiteIds(npcProfile(vehicle)).includes(site.id)) throw new Error(`${vehicle.id} cannot lie up at ${site.id}`);
  const retreat = vehicle.brain!.goals.find((g) => g.kind === 'retreat');
  if (retreat) dropGoal(world, vehicle, retreat, 'home to lie up');
  if (holdsRearm(vehicle)) return;
  const until = world.turn + rearmTurns(vehicle);
  pushGoal(world, vehicle, { kind: 'rearm', targetId: site.id, destination: { ...site.pos }, phase: 'act', reason: 'lie up for fresh gear', until });
}

export function liesUp(vehicle: Vehicle): boolean {
  const top = topGoal(vehicle);
  return top?.kind === 'rearm' && canUseSite(vehicle.pos, getKnownSite(top.targetId!));
}

export function rearmInvalid(world: World, vehicle: Vehicle): string | null {
  return needsFreshGear(world, vehicle) ? null : 'fit again';
}

export function resolveRearm(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (activity.until === undefined) throw new Error(`${vehicle.id} lies up with no until turn`);
  if (!reachSite(vehicle, activity) || world.turn < activity.until) return;
  refitAtHome(world, vehicle);
  finishGoal(world, vehicle, 'refitted at home');
}
