// Event log lines.

import { GOODS } from '../data/goods';
import { CONTRACTS } from '../data/market';
import { partDef } from '../data/parts';
import { NOTES } from '../data/locals';
import type { Contract } from '../sim/market';
import { PERK_LEVELS, SKILL_INFO } from '../data/skills';
import { TERRAIN } from '../data/terrain';
import { TIME } from '../data/time';
import { playerVehicle, vehicleById } from '../sim/damage';
import { gaveUp, isKnockedOut } from '../sim/defeat';
import type { Work, WorkLeft } from '../sim/states';
import { dist, type Vec } from '../sim/vec';
import { REGION } from '../data/region';
import { goodsCount } from '../sim/grid';
import { spareParts } from '../sim/inventory';
import { carriedPart, isStoryWreck } from '../sim/salvage';
import { playerSees } from '../sim/vision';
import { topGoal } from '../sim/npc-activities';
import { npcTraits } from '../sim/npc-decisions';
import { hasPerk } from '../sim/progress';
import { aidData, pleaData, statesHeld, strayData, towData } from '../sim/states';
import { RULES } from '../data/rules';
import { isJunk, maxHp } from '../sim/wear';
import { clockOf } from '../sim/sun';
import type { PartHit } from '../sim/armor';
import { shotDamage } from '../sim/combat';
import { shutDownTurnsLeft } from '../sim/utility';
import type { GameEvent, GridItem, Job, NpcState, Obstacle, PartInstance, RefitJob, ShotRound, SkillId, StateEnding, StateKindId, Vehicle, World } from '../sim/types';
import { fillLine } from './dialogue';

// What a job works on, in words: "Repair Autocannon", "Remove Autocannon from Raider outrider".
export function jobLabel(world: World, v: Vehicle, job: Job): string {
  if (job.kind === 'search') return 'Search';
  if (job.kind === 'weld') return 'Weld scrap armor';
  if (job.kind === 'refit') return refitLabel(world, v, job);
  const part = v.items.find((it) => it.kind === 'part' && it.part.id === job.partId);
  return `${job.kind === 'repair' ? 'Repair' : 'Strip'} ${part ? itemName(part) : 'part'}`;
}

// A refit names its part while it runs and after it is done, so the part is looked up where it lies now.
function refitLabel(world: World, v: Vehicle, job: RefitJob): string {
  const pickup = job.pickup;
  if (pickup?.from === 'truck') {
    const truck = world.vehicles.find((x) => x.id === pickup.vehicleId);
    return `Remove ${partNameIn([v, truck], [], pickup.partId)} from ${truck?.name ?? 'the truck'}`;
  }
  const moved = job.moves.flatMap((m) => v.items.filter((it) => it.id === m.itemId).map(itemName));
  return `Refit ${[...stockPickupName(world, v, pickup), ...moved].join(', ')}`.trim();
}

function stockPickupName(world: World, v: Vehicle, pickup: RefitJob['pickup']): string[] {
  if (pickup?.from !== 'stock') return [];
  return [partNameIn([v], world.salvage.find((s) => s.id === pickup.stockId)?.parts ?? [], pickup.partId)];
}

function partNameIn(vehicles: (Vehicle | undefined)[], loose: PartInstance[], partId: string): string {
  const parts = [...loose, ...vehicles.flatMap((v) => (v?.items ?? []).flatMap((it) => (it.kind === 'part' ? [it.part] : [])))];
  const part = parts.find((p) => p.id === partId);
  return part ? partDef(part.defId).name : 'part';
}

function itemName(it: GridItem): string {
  return it.kind === 'part' ? partDef(it.part.defId).name : GOODS[it.good].name;
}

// What timed work does, in words, for the truck `v` doing it.
export function workLabel(world: World, v: Vehicle, work: Work): string {
  if (work.from === 'job') return jobLabel(world, v, work.job);
  const s = work.state;
  if (s.kind === 'aid') return aidWorkLabel(world, v, s);
  if (s.kind !== 'patch') throw new Error(`No work label for a ${s.kind} state`);
  return s.holder === v.id ? `Patch ${npcName(vehicleById(world, s.other))}` : `Patched by ${npcName(vehicleById(world, s.holder))}`;
}

// The goods of an aid deal in words, like "12 L of fuel and 3 supplies".
export function aidGoods(s: NpcState): string {
  const data = aidData(s);
  return fillLine('{aid}', { aid: { kind: 'aid', fuel: data.fuel, supplies: data.supplies } });
}

// The handover as the truck `v` sees it: who gives what to whom.
function aidWorkLabel(world: World, v: Vehicle, s: NpcState): string {
  const npc = npcName(vehicleById(world, s.holder));
  const playerGives = aidData(s).giver === 'player';
  if (v.id === s.holder) return playerGives ? `Taking ${aidGoods(s)} from you` : `Giving you ${aidGoods(s)}`;
  return playerGives ? `Giving ${aidGoods(s)} to ${npc}` : `Taking ${aidGoods(s)} from ${npc}`;
}

// The share of the work's turns already done, from 0 to 1.
export function workProgress(work: WorkLeft): number {
  return 1 - work.turnsLeft / work.total;
}
import { damage, fuelLiters, hp } from './units';
import { npcName } from '../sim/spawn';

// A part's condition in one word: junk, pristine, or a rebuild count for a part that has broken and
// been rebuilt before (one wear step per break).
export function wearLabel(part: PartInstance): string {
  if (isJunk(part)) return 'junk';
  if (part.wear === 0) return 'pristine';
  return `rebuilt x${part.wear}`;
}

export type ConditionTier = 'pristine' | `w${number}` | 'junk';

// The color step of a part's condition: one per wear level, so brightness can fall as wear grows.
export function conditionTier(part: PartInstance): ConditionTier {
  if (isJunk(part)) return 'junk';
  if (part.wear === 0) return 'pristine';
  return `w${part.wear}`;
}

// Built-in parts are never swapped, bought or sold, so their wear decides no choice.
export function showsCondition(part: PartInstance): boolean {
  return partDef(part.defId).kind !== 'core';
}

// Whether the part works, apart from its wear: scrap only, broken, or its HP.
export function conditionStatus(part: PartInstance): { text: string; tone: 'dim' | 'bad' } {
  if (isJunk(part)) return { text: 'scrap only', tone: 'dim' };
  if (part.hp === 0) return { text: 'broken', tone: 'bad' };
  return { text: `${hp(part.hp)}/${hp(maxHp(part))} HP`, tone: 'dim' };
}

export function vehicleName(world: World, id: string): string {
  if (id === world.player.vehicleId) return 'You';
  const v = findAny(world, id);
  if (v) return npcName(v);
  return isObstacleId(id) ? 'an obstacle' : 'something';
}

function isObstacleId(id: string): boolean {
  return ['wreck', 'rock', 'bld'].some((prefix) => id.startsWith(prefix)) || isStoryWreck({ id });
}

function findAny(world: World, id: string): Vehicle | undefined {
  return world.vehicles.find((v) => v.id === id) ?? world.removed.find((v) => v.id === id);
}

function partName(world: World, vehicleId: string, partId: string): string {
  const p = carriedPart(world, vehicleId, partId);
  return p ? partDef(p.defId).name : 'part';
}

// A seen NPC's top goal as the player reads it, its reason as a sentence, shown under its driver's name. A knocked-out
// driver pursues no goal.
export function formatNpcActivity(world: World, vehicle: Vehicle): string | null {
  if (!vehicle.brain || !playerSees(world, vehicle.pos)) return null;
  if (isKnockedOut(vehicle)) return gaveUp(vehicle) ? 'Gave up' : 'Knocked out';
  const activity = topGoal(vehicle);
  if (!activity) return null;
  return activity.reason.charAt(0).toUpperCase() + activity.reason.slice(1);
}

// "Traits: scavenger, scumbag" for an NPC. The hover panel shows it as one line. Traits stay hidden, so null,
// until the player picks the read the driver perk.
export function formatNpcTraits(world: World, vehicle: Vehicle): string | null {
  const traits = npcTraits(vehicle);
  return hasPerk(world, 'readDriver') ? `Traits: ${traits.join(', ')}` : null;
}

// "Cargo: Salt ×2, Scrap metal ×1. Spares: MG turret" for a truck. The hover panel shows it as one line. Cargo stays
// hidden, so null, until the player picks the cargo eye perk.
export function formatNpcCargo(world: World, vehicle: Vehicle): string | null {
  if (!hasPerk(world, 'cargoEye')) return null;
  const goods = Object.entries(goodsCount(vehicle)).map(([good, n]) => `${GOODS[good].name} ×${n}`);
  const spares = spareParts(vehicle).map((part) => partDef(part.defId).name);
  if (goods.length === 0 && spares.length === 0) return 'Cargo: empty';
  const lines = [...(goods.length > 0 ? [`Cargo: ${goods.join(', ')}`] : []), ...(spares.length > 0 ? [`Spares: ${spares.join(', ')}`] : [])];
  return lines.join('. ');
}

// The spotter mark on a truck: the key that marks it, or the turns its mark has left. Null without the spotter perk.
export function formatNpcMark(world: World, vehicle: Vehicle): string | null {
  if (!hasPerk(world, 'spotter')) return null;
  const mark = world.player.marked.find((m) => m.vehicleId === vehicle.id && world.turn <= m.until);
  return mark ? `Marked: ${mark.until - world.turn} turns left` : '[N] Mark';
}

const COMBAT_LABEL = 'In combat';

// How a state the NPC holds reads from the player's side. A null label keeps the driver's intent hidden.
const STATE_LABELS: Record<StateKindId, (s: NpcState) => string> = {
  feud: () => 'Feud with you',
  backedOff: () => 'Backing off from you',
  tow: (s) => (towData(s).hitched ? 'Towing you' : 'Tow offer to you'),
  turnedDown: () => 'You turned down its tow',
  towPromise: () => 'Promised you a tow',
  answering: () => 'Coming to tow you',
  patch: () => 'Patching your truck',
  truce: () => 'Truce with you',
  grievance: () => 'Angry at your crash',
  plea: (s) => (pleaData(s).plea === 'truce' ? 'Asked you for a truce' : 'Begged you for mercy'),
  trade: () => 'Pulling over to trade with you',
  revenge: () => 'Wants revenge on you',
  escort: () => 'Escorting you',
  aid: (s) => (aidData(s).giver === 'npc' ? 'Bringing you fuel' : 'Waiting for your fuel'),
  combat: () => COMBAT_LABEL,
  strayFire: (s) => `Hit by your stray fire, ${Math.round(strayData(s).damage)} of ${RULES.stray.feudDamage} damage forgiven`,
};

// One line per state the NPC holds toward the player, with turns left when the state has a timer.
// Combat is the one two-sided line: a combat state in either direction between the NPC and the player
// shows once, with the most turns left, where the NPC's own combat state sits (last if only the player holds one).
export function formatNpcStates(world: World, vehicle: Vehicle): string[] {
  const held = statesHeld(world, vehicle.id).filter((s) => s.other === world.player.vehicleId);
  const lines = held.map((s) => (s.kind === 'combat' ? COMBAT_LABEL : turnsText(STATE_LABELS[s.kind](s), s.turnsLeft)));
  const combat = combatLine(world, vehicle);
  const own = held.findIndex((s) => s.kind === 'combat');
  const out = lines.filter((_, i) => held[i].kind !== 'combat');
  if (combat === null) return out;
  out.splice(own < 0 ? out.length : held.slice(0, own).filter((s) => s.kind !== 'combat').length, 0, combat);
  return out;
}

function turnsText(label: string, turnsLeft: number | null): string {
  return turnsLeft === null ? label : `${label}, ${turnsLeft} turn${turnsLeft === 1 ? '' : 's'}`;
}

// The one combat line for the pair, from a combat state in either direction.
function combatLine(world: World, vehicle: Vehicle): string | null {
  const playerId = world.player.vehicleId;
  const turns = world.states
    .filter((s) => s.kind === 'combat' && ((s.holder === vehicle.id && s.other === playerId) || (s.holder === playerId && s.other === vehicle.id)))
    .map((s) => s.turnsLeft ?? 0);
  return turns.length > 0 ? turnsText(COMBAT_LABEL, Math.max(...turns)) : null;
}

// Log lines for the end of a state an NPC holds toward the player. Tow states log through the tow events.
const STATE_ENDED_TEXT: Partial<Record<StateKindId, Record<StateEnding, ((holder: string) => { text: string; cls: string }) | null>>> = {
  feud: {
    expired: (holder) => ({ text: `${holder} gives up the feud with you.`, cls: 'good' }),
    fulfilled: (holder) => ({ text: `${holder} ends the feud: you are beaten.`, cls: 'bad' }),
    broken: (holder) => ({ text: `The feud with ${holder} is over.`, cls: 'dim' }),
  },
  backedOff: {
    expired: (holder) => ({ text: `${holder} stops backing off from you.`, cls: 'dim' }),
    fulfilled: null,
    broken: null,
  },
  // A fulfilled deal logs through its aid event.
  aid: {
    expired: (holder) => ({ text: `The fuel deal with ${holder} ran out.`, cls: 'dim' }),
    fulfilled: null,
    broken: (holder) => ({ text: `The fuel deal with ${holder} is off.`, cls: 'dim' }),
  },
};

function stateEndedText(world: World, e: Extract<GameEvent, { t: 'stateEnded' }>): { text: string; cls: string } | null {
  if (e.state.other !== world.player.vehicleId) return null;
  const line = STATE_ENDED_TEXT[e.state.kind]?.[e.ending];
  return line ? line(vehicleName(world, e.state.holder)) : null;
}

// Damage summed per part, parts with no damage left out.
function partDamage(hits: PartHit[]): Map<string, number> {
  const dealt = new Map<string, number>();
  for (const h of hits) if (h.damage > 0) dealt.set(h.part, (dealt.get(h.part) ?? 0) + h.damage);
  return dealt;
}

// Short part names for damage popups, by part kind and core role.
const PART_SHORT = {
  weapon: 'Gun', engine: 'Eng', armor: 'Arm', cargo: 'Cargo', scanner: 'Scan', store: 'Store', utility: 'Util',
  cab: 'Cab', transmission: 'Trans', wheel: 'Whl', tank: 'Tank',
} as const;

function partShort(world: World, vehicleId: string, partId: string): string {
  const p = carriedPart(world, vehicleId, partId);
  if (!p) throw new Error(`Round hit part ${partId}, which ${vehicleId} does not carry`);
  const def = partDef(p.defId);
  return PART_SHORT[def.kind === 'core' ? def.role : def.kind];
}

// "Crit! Eng: 5, Arm: 2" for the parts of one truck a round damaged, or null when it damaged none.
export function roundLabel(world: World, vehicleId: string, hits: PartHit[], crit: boolean): string | null {
  const dealt = partDamage(hits);
  if (dealt.size === 0) return null;
  const parts = [...dealt].map(([id, d]) => `${partShort(world, vehicleId, id)}: ${damage(d)}`).join(', ');
  return `${crit ? 'Crit! ' : ''}${parts}`;
}

// A log line is plain text. Spans split it into pieces the log colors on their own.
export type LogSpan = { text: string; cls: string };
export type LogLine = { text: string; cls: string; spans?: LogSpan[] };

function spanLine(cls: string, spans: LogSpan[]): LogLine {
  return { text: spans.map((s) => s.text).join(''), cls, spans };
}

function shotText(world: World, e: Extract<GameEvent, { t: 'shot' }>): LogLine | null {
  return firedWithLine(world, e) ? harpoonText(world, e) : gunShotText(world, e);
}

// A shot by or at the player, or one whose stray rounds or blast hit the player. Trucks hit that the shot was not
// aimed at follow as stray damage.
function gunShotText(world: World, e: Extract<GameEvent, { t: 'shot' }>): LogLine | null {
  const me = world.player.vehicleId;
  const damaged = shotDamage(e);
  if (e.shooter !== me && e.target !== me && !damaged.has(me)) return null;
  const strays = [...damaged].filter(([id]) => id !== e.target).flatMap(([id, h]) => [
    { text: `, stray fire hits ${vehicleName(world, id)}`, cls: '' },
    ...damageSpans(world, id, h),
  ]);
  return spanLine(hurts(damaged.get(me)) ? 'bad' : '', [...aimedSpans(world, e, damaged.get(e.target) ?? []), ...strays]);
}

// Whether the shot came from a gun that ties a line, the harpoon.
function firedWithLine(world: World, e: Extract<GameEvent, { t: 'shot' }>): boolean {
  const part = carriedPart(world, e.shooter, e.weapon);
  const def = part && partDef(part.defId);
  return def?.kind === 'weapon' && def.line !== undefined;
}

// A harpoon shot by or at the player: "Harpoon → Buggy: line on Engine (40%)", or "missed", then the damage per
// part. Its one round strays into nobody. The chance is the round's.
function harpoonText(world: World, e: Extract<GameEvent, { t: 'shot' }>): LogLine | null {
  const me = world.player.vehicleId;
  if (e.shooter !== me && e.target !== me) return null;
  const onTarget = shotDamage(e).get(e.target) ?? [];
  const what = harpoonOutcome(world, e);
  return spanLine(e.target === me && hurts(onTarget) ? 'bad' : '', [
    { text: `${partName(world, e.shooter, e.weapon)} → ${vehicleName(world, e.target)}: ${what}`, cls: '' },
    { text: ` (${Math.round(e.chance * 100)}%)`, cls: 'dim' },
    ...damageSpans(world, e.target, onTarget),
  ]);
}

// What the harpoon holds after its shot: "line on Engine", or "missed" when no line holds.
function harpoonOutcome(world: World, e: Extract<GameEvent, { t: 'shot' }>): string {
  const line = world.lines.find((l) => l.from === e.shooter && l.fromPart === e.weapon && l.to === e.target);
  return line ? `line on ${partName(world, e.target, line.toPart)}` : 'missed';
}

// A truck pulled hard enough to tear a harpoon line, and the part the line held took the tear.
function lineTornText(world: World, e: Extract<GameEvent, { t: 'lineTorn' }>): LogLine {
  const mine = e.vehicle === world.player.vehicleId;
  return spanLine(mine ? 'bad' : '', [
    { text: `${vehicleName(world, e.vehicle)} ${mine ? 'tear' : 'tears'} free of a harpoon line`, cls: '' },
    ...damageSpans(world, e.vehicle, [{ part: e.part, damage: e.damage }]),
  ]);
}

function hurts(hits: PartHit[] | undefined): boolean {
  return hits !== undefined && hits.some((h) => h.damage > 0);
}

// A round hits when it damages the aimed part, or for a body shot any part of the target, directly or by splash.
function hitsAim(e: Extract<GameEvent, { t: 'shot' }>, r: ShotRound): boolean {
  const onTarget = [...(r.struck === e.target ? r.hits : []), ...r.blast.filter((b) => b.vehicle === e.target).flatMap((b) => b.hits)];
  return onTarget.some((h) => h.damage > 0 && (e.aim === 'body' || h.part === e.aim));
}

// "MG → Buggy at Cab, 3/6 hit (40%), 1 crit", then the damage per part.
function aimedSpans(world: World, e: Extract<GameEvent, { t: 'shot' }>, onTarget: PartHit[]): LogSpan[] {
  const aim = e.aim === 'body' ? '' : ` at ${partName(world, e.target, e.aim)}`;
  const hits = e.rounds.filter((r) => hitsAim(e, r)).length;
  const crits = e.rounds.filter((r) => r.crit).length;
  return [
    { text: `${partName(world, e.shooter, e.weapon)} → ${vehicleName(world, e.target)}${aim}, ${hits}/${e.rounds.length} hit`, cls: '' },
    { text: ` (${Math.round(e.damageChance * 100)}%)`, cls: 'dim' },
    ...(crits ? [{ text: `, ${crits} crit`, cls: '' }] : []),
    ...damageSpans(world, e.target, onTarget),
  ];
}

// ": Cab −5 broken, Plate −3": inner parts first, then armor in the dim color. A part with no HP left reads broken.
function damageSpans(world: World, vehicleId: string, hits: PartHit[]): LogSpan[] {
  const parts = [...partDamage(hits)].map(([id, d]) => {
    const part = carriedPart(world, vehicleId, id);
    if (!part) throw new Error(`Round hit part ${id}, which ${vehicleId} does not carry`);
    return { part, armor: partDef(part.defId).kind === 'armor', d };
  });
  const spans = [...parts.filter((p) => !p.armor), ...parts.filter((p) => p.armor)].map(({ part, armor, d }): LogSpan => {
    const broken = part.hp <= 0;
    return { text: `${partDef(part.defId).name} −${damage(d)}${broken ? ' broken' : ''}`, cls: broken ? 'bad' : armor ? 'dim' : '' };
  });
  return spans.flatMap((s, i) => [{ text: i === 0 ? ': ' : ', ', cls: '' }, s]);
}

// Only the player's own jobs are logged.
function jobText(world: World, e: Extract<GameEvent, { t: 'job' }>): LogLine | null {
  if (e.vehicle !== world.player.vehicleId) return null;
  const what = jobLabel(world, playerVehicle(world), e.job);
  const lines = {
    started: { text: `${what} started: stay parked about ${e.job.turnsLeft} turns.`, cls: '' },
    cancelled: { text: `${what} cancelled: the truck moved, a hostile came in sight, or required items changed`, cls: 'bad' },
    done: { text: `${what} done`, cls: 'good' },
  };
  return lines[e.outcome];
}

// A storm is local news: log it only when it starts or ends within sight of the player.
function weatherText(world: World, e: Extract<GameEvent, { t: 'weather' }>): LogLine | null {
  const ev = e.event;
  if (ev.kind === 'storm' && dist(playerVehicle(world).pos, ev.pos) - ev.radius > TERRAIN.vision.radius) return null;
  const names = { storm: 'Dust storm', heatwave: 'Heat wave', overcast: 'Overcast' };
  return { text: `${names[ev.kind]} ${e.outcome}`, cls: 'dim' };
}

// A horn out of sight is heard, but the log does not name its truck.
function honkText(world: World, e: Extract<GameEvent, { t: 'honk' }>): LogLine {
  if (e.vehicle === world.player.vehicleId) return { text: 'You honk.', cls: 'dim' };
  const v = findAny(world, e.vehicle);
  return { text: v && playerSees(world, v.pos) ? `${npcName(v)} honks back.` : 'A horn answers out of sight.', cls: '' };
}

// Patch work between the player and an NPC, from the player's side.
function patchText(world: World, e: Extract<GameEvent, { t: 'patch' }>): LogLine {
  const me = world.player.vehicleId;
  const other = vehicleName(world, e.patcher === me ? e.client : e.patcher);
  const lines = {
    started: e.patcher === me ? `You start patching ${other}. Stay parked beside it.` : `${other} starts patching your truck. Stay parked.`,
    done: e.patcher === me ? `You patched ${other}.` : `${other} patched your truck.`,
    lapsed: `The patch with ${other} is off: nobody worked on it.`,
    broken: `The patch with ${other} is off.`,
  };
  const cls = { started: '', done: 'good', lapsed: 'dim', broken: 'dim' }[e.outcome];
  return { text: lines[e.outcome], cls };
}

// Fuel and supplies that changed hands between the player and a driver, and what the driver paid.
function aidText(world: World, e: Extract<GameEvent, { t: 'aid' }>): LogLine {
  const me = world.player.vehicleId;
  if (e.fuel === 0 && e.supplies === 0) return { text: `Nothing changed hands with ${vehicleName(world, e.giver === me ? e.receiver : e.giver)}.`, cls: 'dim' };
  const moved = `${fillLine('{aid}', { aid: { kind: 'aid', fuel: e.fuel, supplies: e.supplies } })}${e.paid > 0 ? ` for ${e.paid}` : ''}`;
  if (e.giver === me) return { text: `You give ${vehicleName(world, e.receiver)} ${moved}.`, cls: '' };
  return { text: `${vehicleName(world, e.giver)} gives you ${moved}.`, cls: 'good' };
}

function aidStartedText(world: World, e: Extract<GameEvent, { t: 'aidStarted' }>): LogLine {
  const me = world.player.vehicleId;
  if (e.giver === me) return { text: `You start handing ${vehicleName(world, e.receiver)} the goods.`, cls: '' };
  return { text: `${vehicleName(world, e.giver)} starts handing you the goods.`, cls: '' };
}

function sayText(world: World, e: Extract<GameEvent, { t: 'say' }>): LogLine {
  const cls = e.speaker === world.player.vehicleId ? 'dim' : '';
  return { text: `${vehicleName(world, e.speaker)}: “${fillLine(e.text, e.vars)}”`, cls };
}

function towOfferText(world: World, e: Extract<GameEvent, { t: 'towOffer' }>): LogLine {
  return { text: `${vehicleName(world, e.by)} offers to tow you to ${siteName(e.town)} for ${e.fee > 0 ? e.fee : 'free'}.`, cls: '' };
}

function towHitchedText(world: World, e: Extract<GameEvent, { t: 'towHitched' }>): LogLine {
  return { text: `${vehicleName(world, e.by)} takes ${vehicleName(world, e.client)} in tow to ${siteName(e.site)}.`, cls: 'dim' };
}

function towDoneText(world: World, e: Extract<GameEvent, { t: 'towDone' }>): LogLine {
  const by = vehicleName(world, e.by);
  const free = e.fee === 0;
  if (e.client === world.player.vehicleId) {
    return free ? { text: `${by} tows you into town for free.`, cls: '' } : { text: `${by} tows you into town and takes ${e.fee}.`, cls: 'bad' };
  }
  return { text: `${by} tows ${vehicleName(world, e.client)} in${free ? ' for free' : ` and takes ${e.fee}`}.`, cls: 'dim' };
}

function escortPaidText(world: World, e: Extract<GameEvent, { t: 'escortPaid' }>): LogLine {
  return { text: `${vehicleName(world, e.client)} pays ${vehicleName(world, e.by)} ${e.fee} for the escort.`, cls: 'dim' };
}

function escortHiredText(world: World, e: Extract<GameEvent, { t: 'escortHired' }>): LogLine {
  return { text: `${vehicleName(world, e.client)} hires ${vehicleName(world, e.by)} as escort to ${siteName(e.site)} for ${e.fee}.`, cls: 'dim' };
}

function escortRefusedText(world: World, e: Extract<GameEvent, { t: 'escortRefused' }>): LogLine {
  return { text: `${vehicleName(world, e.by)} turns down an escort job from ${vehicleName(world, e.client)}.`, cls: 'dim' };
}

// Pleas between two NPCs. The player's own pleas show as radio lines.
function cargoSpilledText(world: World, e: Extract<GameEvent, { t: 'cargoSpilled' }>): LogLine {
  if (e.vehicle !== world.player.vehicleId) return { text: `${vehicleName(world, e.vehicle)}: cargo spilled on the ground`, cls: 'good' };
  const items = e.units === 1 ? 'item' : 'items';
  return { text: `Your ${partName(world, e.vehicle, e.part).toLowerCase()} broke. ${e.units} ${items} fell out.`, cls: 'bad' };
}

function pleaText(world: World, e: Extract<GameEvent, { t: 'plea' }>): LogLine | null {
  const me = world.player.vehicleId;
  if (e.from === me || e.to === me) return null;
  const asks = e.plea === 'truce' ? 'asks for a truce' : 'begs for mercy';
  const answer = e.accepted ? 'granted' : 'refused';
  return { text: `${vehicleName(world, e.from)} ${asks} from ${vehicleName(world, e.to)}: ${answer}`, cls: 'dim' };
}

function towDroppedText(world: World, e: Extract<GameEvent, { t: 'towDropped' }>): LogLine {
  const by = vehicleName(world, e.by);
  if (e.client === world.player.vehicleId) return playerTowDroppedText(by, e.reason);
  const client = vehicleName(world, e.client);
  return { text: e.reason === 'gone' ? `${by} is gone. ${client} is off the rope.` : `${by} drops the tow of ${client}.`, cls: 'dim' };
}

const PLAYER_TOW_DROPPED: Record<Extract<GameEvent, { t: 'towDropped' }>['reason'], (by: string) => string> = {
  refused: (by) => `You turn down the tow from ${by}.`,
  unhitched: (by) => `You unhitch from ${by}.`,
  danger: (by) => `${by} drops the tow. There is danger.`,
  stranded: (by) => `${by} can no longer drive. The tow is off.`,
  gone: (by) => `${by} is gone. The tow is off.`,
  blocked: (by) => `${by} cannot get through to you. The tow is off.`,
};

function playerTowDroppedText(by: string, reason: Extract<GameEvent, { t: 'towDropped' }>['reason']): LogLine {
  return { text: PLAYER_TOW_DROPPED[reason](by), cls: reason === 'refused' || reason === 'unhitched' ? 'dim' : 'bad' };
}

// Whether the player's truck is one of the vehicles, or the player sees or detects one of them.
// The full log debug flag shows every event.
function playerNotices(world: World, ...ids: string[]): boolean {
  if (world.player.fullLog) return true;
  return ids.some((id) => {
    if (id === world.player.vehicleId) return true;
    if (world.player.contacts.some((c) => c.vehicleId === id)) return true;
    const v = findAny(world, id);
    return v !== undefined && playerSees(world, v.pos);
  });
}

// The vehicles in events that log only when the player notices one of them.
const NOTICED: { [K in GameEvent['t']]?: (e: Extract<GameEvent, { t: K }>) => string[] } = {
  collision: (e) => [e.a, e.b],
  partDisabled: (e) => [e.vehicle],
  cargoSpilled: (e) => [e.vehicle],
  destroyed: (e) => [e.vehicle],
  npcKnockout: (e) => [e.vehicle],
  npcWake: (e) => [e.vehicle],
  towHitched: (e) => [e.by, e.client],
  towDone: (e) => [e.by, e.client],
  towDropped: (e) => [e.by, e.client],
  plea: (e) => [e.from, e.to],
  escortPaid: (e) => [e.by, e.client],
  aidStarted: (e) => [e.giver, e.receiver],
  escortHired: (e) => [e.by, e.client],
  escortRefused: (e) => [e.by, e.client],
  caltrops: (e) => [e.vehicle],
  lineTorn: (e) => [e.vehicle],
  claymore: (e) => [e.vehicle, e.other],
};

function unnoticed(world: World, e: GameEvent): boolean {
  const vehicles = NOTICED[e.t] as ((e: GameEvent) => string[]) | undefined;
  return vehicles !== undefined && !playerNotices(world, ...vehicles(e));
}

function searchedText(stock: string): { text: string; cls: string } {
  const site = [...REGION.towns, ...REGION.locations].find((l) => l.id === stock);
  return { text: `Search done${site ? ` at ${site.name}` : ''}.`, cls: 'good' };
}

// The loot one search turn revealed, like "Found 3 Scrap, Machine gun, 12 L of fuel."
function foundText(_world: World, e: Extract<GameEvent, { t: 'found' }>): LogLine {
  const stores = e.fuel > 0 || e.supplies > 0 ? [fillLine('{aid}', { aid: { kind: 'aid', fuel: e.fuel, supplies: e.supplies } })] : [];
  const items = [...Object.entries(e.goods).map(([good, count]) => `${count} ${GOODS[good].name}`), ...e.parts.map((defId) => partDef(defId).name), ...stores];
  return { text: `Found ${items.join(', ')}.`, cls: 'good' };
}

const CONTRACT_OUTCOME = { accepted: ['Contract taken', ''], expiring: ['Contract due soon', 'bad'], done: ['Contract done', 'good'], failed: ['Contract failed', 'bad'], lapsed: ['Contract lapsed', 'dim'] } as const;

function contractText(c: Contract, outcome: keyof typeof CONTRACT_OUTCOME): { text: string; cls: string } {
  const [label, cls] = CONTRACT_OUTCOME[outcome];
  const tail = outcome === 'expiring' ? `, ${contractDue(c)}` : `, pays ${c.reward}`;
  return { text: `${label}: ${contractSummary(c)}${tail}`, cls };
}

// One line naming what a contract asks for.
export function contractSummary(c: Contract): string {
  if (c.kind === 'haul') return `${c.rush ? 'Rush: ' : ''}Haul ${c.units} ${GOODS[c.good].name} to ${siteName(c.to)}`;
  if (c.kind === 'fetch') {
    const rebuilt = CONTRACTS.fetch.maxWear === 1 ? 'rebuilt at most once' : `rebuilt at most ${CONTRACTS.fetch.maxWear} times`;
    return `Bring ${partDef(c.defId).name} to ${siteName(c.shop)}: working, ${rebuilt}`;
  }
  return `Knock out or wreck any ${c.targetName}`;
}

// How long a contract allows from acceptance, in whole game hours.
export function contractWindow(c: Contract): string {
  return `${Math.max(1, Math.round(c.window / (TIME.turnsPerDay / 24)))} h`;
}

// The game time a contract is due. It fails at the end of its deadline turn.
export function contractDue(c: Contract): string {
  return `by ${clockLabel(c.deadline + 1)}`;
}

export function clockLabel(turn: number): string {
  const { day, hour } = clockOf(turn);
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  return `Day ${day} ${hh}:${String(mm).padStart(2, "0")}`;
}


function siteName(id: string): string {
  const site = [...REGION.towns, ...REGION.locations].find((l) => l.id === id);
  if (!site) throw new Error(`Unknown site ${id}`);
  return site.name;
}

// A rank that opens a perk pair says so, since the pick waits on the character screen.
function skillUpText(skill: SkillId, rank: number): string {
  const bought = `${SKILL_INFO[skill].name} rank ${rank} bought.`;
  return (PERK_LEVELS as readonly number[]).includes(rank) ? `${bought} Perk ready [C].` : bought;
}

// NPC goals are debug lines. Players read intent from what a driver does.
function activityText(world: World, e: Extract<GameEvent, { t: 'activity' }>): LogLine | null {
  const vehicle = world.vehicles.find((v) => v.id === e.vehicle);
  return world.player.fullLog && vehicle ? { text: `${npcName(vehicle)}: ${e.activity ?? 'idle'} — ${e.reason}`, cls: 'dim' } : null;
}

// A stall is a bug, so the full log shows it loudly.
function stallText(world: World, e: Extract<GameEvent, { t: 'stall' }>): LogLine | null {
  return world.player.fullLog ? { text: `Bug: ${vehicleName(world, e.vehicle)} stuck on ${e.goal ?? 'idle'} (${e.reason}), gave it up`, cls: 'bad' } : null;
}

function infoText(world: World, e: Extract<GameEvent, { t: 'info' }>): LogLine | null {
  return e.debug && !world.player.fullLog ? null : { text: e.text, cls: 'dim' };
}

// Caltrops on the player's wheels read as bad, the player's caltrops on another truck as good, the rest dim.
function caltropsText(world: World, e: Extract<GameEvent, { t: 'caltrops' }>): LogLine | null {
  const me = world.player.vehicleId;
  const [text, cls] = e.vehicle === me ? ['You drive into caltrops', 'bad'] : [`${vehicleName(world, e.vehicle)} drives into caltrops`, e.source === me ? 'good' : 'dim'];
  return spanLine(cls, [{ text, cls: '' }, ...damageSpans(world, e.vehicle, e.hits)]);
}

// An emitter pulse the player fired, naming the trucks it shut down, or one that shut the player down. Others log
// nothing.
function pulseText(world: World, e: Extract<GameEvent, { t: 'pulse' }>): LogLine | null {
  const me = playerVehicle(world);
  if (e.vehicle === me.id) {
    if (e.hit.length === 0) return { text: 'Your emitter pulse catches nobody', cls: 'dim' };
    return { text: `Your emitter pulse shuts down ${e.hit.map((id) => vehicleName(world, id)).join(', ')}`, cls: 'good' };
  }
  if (!e.hit.includes(me.id)) return null;
  const left = shutDownTurnsLeft(world, me);
  return { text: `${vehicleName(world, e.vehicle)}'s emitter pulse shuts your truck down for ${left} ${left === 1 ? 'turn' : 'turns'}`, cls: 'bad' };
}

// An armed claymore ram that broke and blew up on its own truck, with the damage it did there.
function cookOffText(world: World, e: Extract<GameEvent, { t: 'claymoreCookOff' }>): LogLine {
  const me = world.player.vehicleId;
  const hitByMe = world.vehicles.find((v) => v.id === e.vehicle)?.lastHitBy === me;
  const [text, cls] = e.vehicle === me ? ['Your claymore ram breaks and blows up', 'bad'] : [`${vehicleName(world, e.vehicle)}'s claymore ram breaks and blows up`, hitByMe ? 'good' : 'dim'];
  return spanLine(cls, [{ text, cls: '' }, ...damageSpans(world, e.vehicle, e.hits)]);
}

const OBSTACLE_NAMES: Record<Obstacle['kind'], string> = { rock: 'a rock', wreck: 'a wreck', building: 'a building', water: 'the water', site: 'a structure', landmark: 'a landmark' };

// A claymore ram blast the player set off, one that hit the player, or a seen one between other trucks. The line
// lists the blasted truck's damage. The ram's owner sees its own damage on its truck.
function claymoreText(world: World, e: Extract<GameEvent, { t: 'claymore' }>): LogLine {
  const me = world.player.vehicleId;
  const obstacle = world.obstacles.find((o) => o.id === e.other);
  if (obstacle) {
    const who = e.vehicle === me ? 'Your' : `${vehicleName(world, e.vehicle)}'s`;
    return spanLine(e.vehicle === me ? 'bad' : 'dim', [{ text: `${who} claymore ram blows up against ${OBSTACLE_NAMES[obstacle.kind]}`, cls: '' }, ...damageSpans(world, e.vehicle, e.selfHits)]);
  }
  const [who, whom, cls] =
    e.vehicle === me ? ['Your', vehicleName(world, e.other), 'good']
    : e.other === me ? [`${vehicleName(world, e.vehicle)}'s`, 'your truck', 'bad']
    : [`${vehicleName(world, e.vehicle)}'s`, vehicleName(world, e.other), 'dim'];
  return spanLine(cls, [{ text: `${who} claymore ram blasts ${whom}`, cls: '' }, ...damageSpans(world, e.other, e.hits)]);
}

// Events whose log line has its own function.
const EVENT_TEXTS: { [K in GameEvent['t']]?: (world: World, e: Extract<GameEvent, { t: K }>) => LogLine | null } = {
  activity: activityText,
  stall: stallText,
  info: infoText,
  townPatch: () => ({ text: 'You patch your truck with scrap.', cls: 'good' }),
  scrapPatch: (_, e) => ({ text: `You patch up your car with scrap until it starts moving again.${e.fuel > 0 ? ` Townsfolk spare you ${fuelLiters(e.fuel)} L of fuel.` : ''}`, cls: 'good' }),
  npcKnockout: (world, e) => ({ text: `${vehicleName(world, e.vehicle)} knocked out`, cls: 'good' }),
  npcWake: (world, e) => ({ text: `${vehicleName(world, e.vehicle)} regains consciousness`, cls: 'dim' }),
  stateEnded: stateEndedText,
  empty: () => null, // the HUD shows ammo; the log holds no gun state
  utility: () => null, // the utility row and the world show a use; effects with news log their own events
  caltrops: caltropsText,
  lineTorn: lineTornText,
  pulse: pulseText,
  claymore: claymoreText,
  claymoreCookOff: cookOffText,
  found: foundText,
  say: sayText,
  job: jobText,
  weather: weatherText,
  honk: honkText,
  patch: patchText,
  aid: aidText,
  aidStarted: aidStartedText,
  towOffer: towOfferText,
  towHitched: towHitchedText,
  towDone: towDoneText,
  towDropped: towDroppedText,
  // The dialogue panel shows the player's calls.
  call: () => null,
  plea: pleaText,
  cargoSpilled: cargoSpilledText,
  escortPaid: escortPaidText,
  escortHired: escortHiredText,
  escortRefused: escortRefusedText,
  note: (_, e) => ({ text: `Noted in your journal: ${NOTES[e.id].title}.`, cls: 'good' }),
};

// Returns null for events not worth a log line.
export function eventText(world: World, e: GameEvent): LogLine | null {
  if (unnoticed(world, e)) return null;
  const own = EVENT_TEXTS[e.t] as ((world: World, e: GameEvent) => LogLine | null) | undefined;
  if (own) return own(world, e);
  const n = (id: string) => vehicleName(world, id);
  const me = world.player.vehicleId;
  switch (e.t) {
    // Crashes are shown by the hit truck and its part damage, not logged.
    case 'collision':
      return null;
    case 'shot':
      return shotText(world, e);
    case 'partDisabled':
      return { text: `${n(e.vehicle)}: ${partName(world, e.vehicle, e.part)} disabled`, cls: e.vehicle === me ? 'bad' : 'good' };
    case 'destroyed':
      return { text: `${n(e.vehicle)} destroyed`, cls: 'good' };
    case 'hostile':
      return e.against === me ? { text: `${n(e.vehicle)} turns hostile to you`, cls: 'bad' } : null;
    case 'practice':
      return null;
    case 'skillUp':
      return { text: skillUpText(e.skill, e.level), cls: 'good' };
    case 'money':
      return { text: `${e.amount > 0 ? '+' : ''}${e.amount} money: ${e.reason}`, cls: e.amount > 0 ? 'good' : 'bad' };
    case 'discover': {
      const loc = [...REGION.towns, ...REGION.locations].find((l) => l.id === e.location);
      return { text: `Discovered ${loc?.name ?? e.location}`, cls: 'good' };
    }
    case 'supply':
      return { text: e.text, cls: 'bad' };
    case 'death':
      return { text: 'You died.', cls: 'bad' };
    case 'knockout':
      return { text: 'You are knocked out.', cls: 'bad' };
    case 'wake':
      return { text: 'You come to.', cls: 'dim' };
    case 'searched':
      return searchedText(e.stock);
    case 'contract':
      return contractText(e.contract, e.outcome);
    case 'breakdown':
      return e.vehicle === me ? { text: `${partName(world, e.vehicle, e.part)} broke down`, cls: 'bad' } : null;
    case 'spawn':
    case 'despawn':
    case 'arrived':
      return null;
  }
  throw new Error(`EVENT_TEXTS has no log text for ${e.t}`);
}

// Words for the goods table, shared by the town market and the truck goods trade.
export type SaleEstimate =
  | { kind: "none" }
  | { kind: "unrecorded" }
  | { kind: "gain" | "loss"; perUnit: number; avgCost: number }
  | { kind: "even"; avgCost: number };

export const GOODS_COLUMNS = { good: "Good", theirs: "Theirs", buy: "Buy", sell: "Sell", held: "Held", profit: "Profit/unit" } as const;

// Describes the basis rules of noteCostBasis() (sim/economy.ts), addBasis()/takeBasis() (sim/salvage.ts) and loadHaul() (sim/market.ts).
export const PROFIT_HEAD_TITLE = "Sell price here minus your average cost. Salvaged and hauled goods count at their usual value.";

function checkEstimate(held: number, sell: number, basis: number | undefined): void {
  if (!Number.isInteger(held) || held < 0) throw new Error(`saleEstimate: bad held count ${held}`);
  if (!Number.isFinite(sell)) throw new Error(`saleEstimate: bad sell price ${sell}`);
  if (basis !== undefined) checkBasis(basis);
}

function checkBasis(basis: number): void {
  if (!Number.isFinite(basis) || basis < 0) throw new Error(`saleEstimate: bad cost basis ${basis}`);
}

export function saleEstimate(held: number, sell: number, basis: number | undefined): SaleEstimate {
  checkEstimate(held, sell, basis);
  if (held === 0) return { kind: "none" };
  if (basis === undefined) return { kind: "unrecorded" };
  const diff = Math.round(sell - basis);
  const avgCost = Math.round(basis);
  if (diff === 0) return { kind: "even", avgCost };
  return { kind: diff > 0 ? "gain" : "loss", perUnit: Math.abs(diff), avgCost };
}

export function estimateText(e: SaleEstimate): string {
  switch (e.kind) {
    case "none": return "";
    case "unrecorded": return "?";
    case "even": return "0";
    case "gain": return `+${e.perUnit}`;
    case "loss": return `\u2212${e.perUnit}`;
  }
}

export function estimateTitle(e: SaleEstimate): string {
  switch (e.kind) {
    case "none": return "";
    case "unrecorded": return "No cost on record";
    default: return `Avg cost ${e.avgCost}`;
  }
}

export function lotTitle(direction: "buy" | "sell", count: number, total: number): string {
  return direction === "buy" ? `Buy ${count} for ${total} total` : `Sell all ${count} for ${total} total`;
}
