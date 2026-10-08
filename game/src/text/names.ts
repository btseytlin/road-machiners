// Words for the sim's ids and data ids. Each lookup returns a Msg, so the words follow the active language. The
// coverage test checks that every id has its words in every language.
import { WORLD_SETTINGS } from '../data/modes';
import type { LineId } from '../data/dialogue';
import { FEMALE_NAMES, FIRST_NAMES, SURNAMES, type TraitId } from '../data/npcs';
import type { PerkId } from '../data/skills';
import type { Faction, GameModeId, GoalReason, MoneyReason, Refusal, SimNote, SkillId, UnitId, Vehicle, World, WorldSetup, WorldSettings } from '../sim/types';
import { byId, list, t, type Msg } from './msg';

export const partName = (defId: string): Msg => byId(`part.${defId}`);
export const chassisName = (id: string): Msg => byId(`chassis.${id}`);
export const goodName = (id: string): Msg => byId(`good.${id}`);
// A good's name inside a sentence, like "scrap metal".
export const goodLower = (id: string): Msg => byId(`good.${id}.lower`);
export const siteName = (id: string): Msg => byId(`site.${id}`);
export const terrainName = (id: string): Msg => byId(`terrain.${id}`);
export const templateName = (id: string): Msg => byId(`npc.${id}`);
export const professionName = (id: string): Msg => byId(`npc.${id}.profession`);
export const traitName = (id: TraitId): Msg => t(`trait.${id}`);
export const factionName = (id: Faction): Msg => t(`faction.${id}`);
export const skillName = (id: SkillId): Msg => t(`skill.${id}`);
export const skillGrows = (id: SkillId): Msg => t(`skill.${id}.grows`);
export const perkName = (id: PerkId): Msg => t(`perk.${id}`);
export const perkRule = (id: PerkId): Msg => t(`perk.${id}.rule`);
export const goalText = (reason: GoalReason): Msg => t(`goal.${reason}`);
export const lineKey = (id: LineId): `line.${LineId}` => `line.${id}`;
export const unitCount = (unit: UnitId, n: number): Msg => t(`unit.${unit}`, { n });
export const modeName = (id: GameModeId): Msg => t(`mode.${id}`);
export const modeDescription = (id: GameModeId): Msg => t(`mode.${id}.description`);
export const settingName = (id: keyof WorldSettings): Msg => t(`setting.${id}`);
export const settingDescription = (id: keyof WorldSettings): Msg => t(`setting.${id}.description`);

export function setupText(setup: WorldSetup): Msg {
  const settings = (Object.keys(WORLD_SETTINGS) as (keyof WorldSettings)[]).map((id) =>
    t('setup.part', { setting: settingName(id), pct: t('setting.percent', { n: Math.round(setup.settings[id] * 100) }) }));
  return list([modeName(setup.mode), ...settings]);
}

// A truck as texts name it: the player's own truck, an NPC's profession and driver, like "Roamer Silas Kane", or for
// a truck with no driver, like a test truck, its chassis.
export function vehicleTitle(world: World, v: Vehicle): Msg {
  if (v.id === world.player.vehicleId) return t('vehicle.yours');
  if (!v.brain) return chassisName(v.chassisId);
  return t('vehicle.npc', { profession: professionName(v.brain.templateId), driver: driverName(v) });
}

// The truck with this id, alive or removed this turn.
export function vehicleTitleOf(world: World, id: string): Msg {
  const v = world.vehicles.find((x) => x.id === id) ?? world.removed.find((x) => x.id === id);
  if (!v) throw new Error(`No vehicle ${id} to name`);
  return vehicleTitle(world, v);
}

export function driverName(v: Vehicle): Msg {
  if (!v.brain) throw new Error(`${v.id} has no driver`);
  return fullName(v.brain.driver);
}

export function fullName(driver: string): Msg {
  const [first, last, ...rest] = driver.split(' ');
  if (rest.length > 0 || !FIRST_NAMES.includes(first) || !SURNAMES.includes(last)) {
    throw new Error(`Driver "${driver}" is not a first name and a surname from the name lists`);
  }
  const surname = FEMALE_NAMES.has(first) ? `driver.last.${last}.f` : `driver.last.${last}`;
  return t('driver.full', { first: byId(`driver.first.${first}`), last: byId(surname) });
}

type NoteWords = { [K in SimNote['id']]: (note: Extract<SimNote, { id: K }>) => Msg };
const NOTES: NoteWords = {
  engineHot: () => t('note.engineHot'),
  engineOverheat: (n) => t('note.engineOverheat', { hp: n.hp }),
  overdriveCutOut: () => t('note.overdriveCutOut'),
  engineDoused: (n) => t('note.engineDoused', { supplies: n.supplies }),
  outOfSupplies: (n) => t('note.outOfSupplies', { health: n.health }),
  noRoomFuel: (n) => t('note.noRoomFuel', { fuel: n.fuel }),
  noRoomSupplies: (n) => t('note.noRoomSupplies', { supplies: n.supplies }),
  tankLeak: (n) => t('note.tankLeak', { fuel: n.fuel }),
  filledSupplies: (n) => t('note.filledSupplies', { site: siteName(n.site) }),
  hazard: () => t('note.hazard'),
  spawnBlocked: (n) => t('note.spawnBlocked', { template: templateName(n.template) }),
};

export function noteText(note: SimNote): Msg {
  return (NOTES[note.id] as (n: SimNote) => Msg)(note);
}

export function moneyReasonText(world: World, reason: MoneyReason): Msg {
  if (reason.kind === 'towing') return t('money.towing', { vehicle: vehicleTitleOf(world, reason.vehicle) });
  return reason.kind === 'contract' ? t('money.contract') : t('money.failedHaul');
}

type Plain<R> = R extends { id: infer I } ? (keyof R extends 'id' ? I : never) : never;
type RefusalWords = { [K in Exclude<Refusal['id'], Plain<Refusal>>]: (world: World, r: Extract<Refusal, { id: K }>) => Msg };
const REFUSALS: RefusalWords = {
  badLayout: (world, r) => t('refusal.badLayout', { cause: refusalText(world, r.cause) }),
  looting: (world, r) => t(`refusal.looting.${r.place}`, { by: vehicleTitleOf(world, r.by) }),
  notActive: (_, r) => t(`refusal.notActive.${r.state}`),
  topRank: (_, r) => t('refusal.topRank', { skill: skillName(r.skill) }),
  utilityPassive: (_, r) => t('refusal.utilityPassive', { part: partName(r.part) }),
  utilityOrder: (_, r) => t(`refusal.utilityOrder.${r.order}`, { part: partName(r.part) }),
  utilityBlocked: (_, r) => t('refusal.utilityBlocked', { part: partName(r.part), reason: t(`block.${r.block}`) }),
  needsXp: (_, r) => t('refusal.needsXp', { cost: r.cost, have: r.have }),
};

// Why the sim turned a command down, in words.
export function refusalText(world: World, r: Refusal): Msg {
  const words = (REFUSALS as Record<string, ((world: World, r: Refusal) => Msg) | undefined>)[r.id];
  return words ? words(world, r) : t(`refusal.${r.id as Plain<Refusal>}`);
}
