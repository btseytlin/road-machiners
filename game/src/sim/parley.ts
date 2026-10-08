// Ending or dodging a fight by talk. A truce ends the feuds between two sides for a while. Mercy is a truce the
// loser buys with its cargo. A threat asks a driver at peace for its cargo. A pile claim warns other drivers off a
// handed-over pile through the loot warnings of src/sim/loot-warning.ts. An NPC answers each with a weighted decision. Radio talk with the player lives in src/sim/dialogue.ts, and this module owns what the answers do.

import { SPAWN } from '../data/npcs';
import { isHostile } from './combat';
import { isKnockedOut, standDown } from './defeat';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { partSellPrice } from './economy';
import { corePart, isMounted } from './grid';
import { applyRefitLayout } from './inventory';
import { creditBounty } from './market';
import { defyThreat, finishGoal, pushGoal, topGoal } from './npc-activities';
import { canArgue, fightOver, warnTruck } from './loot-warning';
import { decide, holdsUp, perceiveDanger, robbedFor, visibleHostiles, wantsLoot } from './npc-decisions';
import { SPARE_LINE } from '../data/dialogue';
import { vehicleHasPerk } from './progress';
import { backedOff, canReachSalvage, claimantOf, claimPile, createCargoSalvage, dumpOnPile, hasCargo, takeError } from './salvage';
import { isStranded } from './stats';
import { addState, endState, lootWarningData, pleaData, stateOf } from './states';
import type { DecisionOptions } from '../data/npcs';
import type { Aim, GridItem, Plea, SalvageStock, Vehicle, World } from './types';
import { canVehicleSee } from './vision';
import { dist } from './vec';

export type ThreatAnswer = DecisionOptions['threatened'];

function sideOf(world: World, v: Vehicle): Vehicle[] {
  if (!v.brain) return [v];
  return world.vehicles.filter((x) => x.id === v.id || (x.brain && x.faction === v.faction && dist(x.pos, v.pos) <= SPAWN.neighborHelp));
}

export function makePeace(world: World, a: Vehicle, b: Vehicle): void {
  for (const p of sideOf(world, a)) {
    for (const q of sideOf(world, b)) {
      if (p.id === q.id) continue;
      for (const s of [stateOf(world, 'feud', p.id, q.id), stateOf(world, 'feud', q.id, p.id)]) if (s) endState(world, s, 'broken');
      addState(world, 'truce', p.id, q.id, { kind: 'none' });
      addState(world, 'truce', q.id, p.id, { kind: 'none' });
      holdFire(p, q);
      holdFire(q, p);
    }
  }
}

function holdFire(v: Vehicle, target: Vehicle): void {
  for (const [id, order] of Object.entries(v.weaponOrders)) if (order.targetId === target.id) delete v.weaponOrders[id];
  if (v.brain) delete v.brain.attackers[target.id];
}

export function yieldTo(world: World, loser: Vehicle, winner: Vehicle, dumped: SalvageStock | null = null): void {
  const stock = hasCargo(loser) ? createCargoSalvage(world, loser, 1) : dumped;
  cede(world, loser, winner, stock, 'take the handed-over cargo');
  creditYield(world, loser, winner);
}

export function abandonSpill(world: World, loser: Vehicle, winner: Vehicle, stock: SalvageStock): void {
  cede(world, loser, winner, stock, 'take the spilled cargo');
}

function cede(world: World, loser: Vehicle, winner: Vehicle, stock: SalvageStock | null, reason: string): void {
  makePeace(world, loser, winner);
  endFight(world, loser, winner);
  const grudge = stateOf(world, 'revenge', winner.id, loser.id);
  if (grudge) endState(world, grudge, 'fulfilled');
  if (stock && winner.brain) goTake(world, winner, stock, [loser.id], reason);
}

function goTake(world: World, npc: Vehicle, stock: SalvageStock, warned: string[], reason: string): void {
  pushGoal(world, npc, { kind: 'loot', targetId: stock.id, destination: { ...stock.pos }, phase: 'travel', reason });
  claimPile(world, stock, npc, warned);
}

export function surrenderTo(world: World, loser: Vehicle, robber: Vehicle): void {
  yieldTo(world, loser, robber, dumpWantedParts(world, loser));
}

export function giveUpTo(world: World, loser: Vehicle, winner: Vehicle): void {
  makePeace(world, loser, winner);
  const grudge = stateOf(world, 'revenge', winner.id, loser.id);
  if (grudge) endState(world, grudge, 'fulfilled');
}

export function standDownTo(world: World, loser: Vehicle, winner: Vehicle): void {
  standDown(world, loser, winner.id);
  makePeace(world, loser, winner);
  endFight(world, loser, winner);
  const grudge = stateOf(world, 'revenge', winner.id, loser.id);
  if (grudge) endState(world, grudge, 'fulfilled');
  creditYield(world, loser, winner);
}

function endFight(world: World, a: Vehicle, b: Vehicle): void {
  for (const [p, q] of [[a, b], [b, a]]) {
    const fight = stateOf(world, 'combat', p.id, q.id);
    if (fight) endState(world, fight, 'broken');
  }
}

function creditYield(world: World, loser: Vehicle, winner: Vehicle): void {
  if (loser.brain && vehicleHasPerk(world, winner, 'bountyTalk')) creditBounty(world, loser);
}

export type PleaAnswer = 'yes' | 'no' | 'demand';

export function answersPlea(world: World, answerer: Vehicle, pleader: Vehicle, plea: Plea): PleaAnswer {
  const danger = perceiveDanger(world, answerer, pleader);
  if (plea === 'truce') {
    if (holdsUp(world, answerer, pleader, danger)) return 'demand';
    return decide(world, answerer, 'truceOffered', pleader.id, danger) === 'accept' ? 'yes' : 'no';
  }
  return decide(world, answerer, 'mercyBegged', pleader.id, danger) === 'spare' ? 'yes' : 'no';
}

export function answersHoldUp(world: World, prey: Vehicle, robber: Vehicle, answer: ThreatAnswer): void {
  if (!holdsUp(world, robber, prey, null)) throw new Error(`${robber.id} does not hold up ${prey.id}`);
  if (answer === 'comply') yieldTo(world, prey, robber);
  else defyThreat(world, prey, robber, answer);
}

function grantPlea(world: World, pleader: Vehicle, answerer: Vehicle, plea: Plea): void {
  const held = stateOf(world, 'plea', pleader.id, answerer.id);
  if (!held) throw new Error(`${pleader.id} holds no plea to ${answerer.id}`);
  endState(world, held, 'fulfilled');
  if (plea === 'truce') makePeace(world, pleader, answerer);
  else yieldTo(world, pleader, answerer);
}

export function plead(world: World, npc: Vehicle, foe: Vehicle, plea: Plea): void {
  addState(world, 'plea', npc.id, foe.id, { kind: 'plea', plea, answered: foe.brain !== null });
  if (!foe.brain) {
    world.events.push({ t: 'plea', from: npc.id, to: foe.id, plea, accepted: null });
    return;
  }
  const answer = answersPlea(world, foe, npc, plea);
  world.events.push({ t: 'plea', from: npc.id, to: foe.id, plea, accepted: answer === 'yes' });
  if (answer === 'yes') grantPlea(world, npc, foe, plea);
  if (answer !== 'demand') return;
  const reply = decide(world, npc, 'threatened', foe.id, perceiveDanger(world, npc, foe));
  answersHoldUp(world, npc, foe, reply);
  if (reply !== 'comply') return;
  const held = stateOf(world, 'plea', npc.id, foe.id);
  if (held) endState(world, held, 'fulfilled');
}

export function settlePlayerPlea(world: World, npc: Vehicle, plea: Plea, accepted: boolean): void {
  const me = playerVehicle(world);
  addState(world, 'plea', me.id, npc.id, { kind: 'plea', plea, answered: true });
  world.events.push({ t: 'plea', from: me.id, to: npc.id, plea, accepted });
  if (accepted) grantPlea(world, me, npc, plea);
}

export function pendingPlea(world: World, npc: Vehicle): Plea | null {
  const s = stateOf(world, 'plea', npc.id, world.player.vehicleId);
  if (!s || pleaData(s).answered) return null;
  return pleaData(s).plea;
}

export function answerPlea(world: World, npc: Vehicle, accepted: boolean): void {
  const s = stateOf(world, 'plea', npc.id, world.player.vehicleId);
  if (!s || pleaData(s).answered) throw new Error(`${npc.id} has no plea waiting for the player`);
  const data = pleaData(s);
  data.answered = true;
  world.events.push({ t: 'plea', from: npc.id, to: world.player.vehicleId, plea: data.plea, accepted });
  if (accepted) grantPlea(world, npc, playerVehicle(world), data.plea);
}

export function standDownBeggar(world: World, npc: Vehicle): void {
  const s = stateOf(world, 'plea', npc.id, world.player.vehicleId);
  if (!s || pleaData(s).answered) throw new Error(`${npc.id} has no plea waiting for the player`);
  const data = pleaData(s);
  data.answered = true;
  world.events.push({ t: 'plea', from: npc.id, to: world.player.vehicleId, plea: data.plea, accepted: true });
  endState(world, s, 'fulfilled');
  standDownTo(world, npc, playerVehicle(world));
}

export function playerPleaded(world: World, npc: Vehicle): boolean {
  return stateOf(world, 'plea', world.player.vehicleId, npc.id) !== null;
}

export function answersThreat(world: World, npc: Vehicle): ThreatAnswer {
  const me = playerVehicle(world);
  return decide(world, npc, 'threatened', me.id, perceiveDanger(world, npc, me));
}

export function settleThreat(world: World, npc: Vehicle, answer: ThreatAnswer): void {
  const me = playerVehicle(world);
  if (answer === 'comply') yieldTo(world, npc, me);
  else defyThreat(world, npc, me, answer);
}

export function defendClaim(world: World, claimant: Vehicle, trespasser: Vehicle): void {
  fightOver(world, claimant, trespasser, 'defend its claimed loot');
}

export function warnedOff(world: World, vehicle: Vehicle, stock: SalvageStock): boolean {
  const claimant = claimantOf(world, stock);
  if (!claimant || claimant.id === vehicle.id || !canVehicleSee(world, claimant, vehicle.pos)) return false;
  if (backsOffClaim(world, claimant, vehicle, stock) && !backedOff(stock, vehicle.id)) stock.pile!.claim!.warned.push(vehicle.id);
  return true;
}

function backsOffClaim(world: World, claimant: Vehicle, vehicle: Vehicle, stock: SalvageStock): boolean {
  if (!backedOff(stock, vehicle.id) && canArgue(world, claimant, vehicle)) return lootWarningData(warnTruck(world, claimant, vehicle, stock.id, 'fight')).answer === 'comply';
  finishGoal(world, vehicle, 'the loot is claimed');
  return true;
}

function claimedBy(world: World, npc: Vehicle): SalvageStock[] {
  return world.salvage.filter((stock) => claimantOf(world, stock) === npc);
}

export function claimSpill(world: World, victim: Vehicle, stock: SalvageStock): void {
  if (claimantOf(world, stock)) return;
  const robbers = world.vehicles.filter((npc) => npc.brain && npc.id !== victim.id && claimsSpillOf(world, npc, victim, stock));
  const robber = robbers.sort((a, b) => dist(a.pos, stock.pos) - dist(b.pos, stock.pos))[0];
  if (!robber) return;
  goTake(world, robber, stock, [], 'take the spilled cargo');
  if (!victim.brain || isKnockedOut(victim)) return;
  if (decide(world, victim, 'threatened', robber.id, perceiveDanger(world, victim, robber)) === 'comply') abandonSpill(world, victim, robber, stock);
}

function claimsSpillOf(world: World, npc: Vehicle, victim: Vehicle, stock: SalvageStock): boolean {
  if (!isHostile(world, npc, victim) || !robbedFor(world, npc, victim)) return false;
  return !isStranded(world, npc) && !isKnockedOut(npc) && canVehicleSee(world, npc, stock.pos);
}

export function spillClaimOn(world: World, npc: Vehicle): SalvageStock | null {
  const me = playerVehicle(world);
  if (!isHostile(world, npc, me)) return null;
  return claimedBy(world, npc).find((stock) => stock.pile!.fromPlayer && !backedOff(stock, me.id)) ?? null;
}

export function takeClaimed(world: World, stock: SalvageStock): void {
  const claimant = claimantOf(world, stock);
  const me = playerVehicle(world);
  if (!claimant || !canVehicleSee(world, claimant, me.pos)) return;
  stock.pile!.claim!.warned.push(me.id);
  defendClaim(world, claimant, me);
}

export function guardsClaim(world: World, npc: Vehicle): boolean {
  const me = playerVehicle(world);
  if (!canVehicleSee(world, npc, me.pos)) return false;
  return claimedBy(world, npc).some((stock) => canReachSalvage(me, stock) && !backedOff(stock, me.id));
}

export function backOffClaims(world: World, npc: Vehicle): void {
  for (const stock of claimedBy(world, npc)) if (!backedOff(stock, world.player.vehicleId)) stock.pile!.claim!.warned.push(world.player.vehicleId);
}

export function defyClaims(world: World, npc: Vehicle): void {
  const me = playerVehicle(world);
  backOffClaims(world, npc);
  defendClaim(world, npc, me);
}

type PartItem = Extract<GridItem, { kind: 'part' }>;

function fightsPlayer(world: World, npc: Vehicle): boolean {
  const top = npc.brain ? topGoal(npc) : null;
  return top?.kind === 'fight' && top.targetId === world.player.vehicleId && world.player.state === 'active';
}

export function hasStrandedPrey(world: World, npc: Vehicle): boolean {
  return fightsPlayer(world, npc) && strandedPrey(world, npc)?.id === world.player.vehicleId;
}

export function strandedPrey(world: World, npc: Vehicle): Vehicle | null {
  const prey = fightTarget(world, npc);
  if (!prey || !isBeaten(world, npc, prey)) return null;
  return visibleHostiles(world, npc).every((foe) => foe.id === prey.id) ? prey : null;
}

function fightTarget(world: World, npc: Vehicle): Vehicle | null {
  const top = npc.brain ? topGoal(npc) : null;
  if (top?.kind !== 'fight') return null;
  return world.vehicles.find((v) => v.id === top.targetId) ?? null;
}

function isBeaten(world: World, npc: Vehicle, prey: Vehicle): boolean {
  return isStranded(world, prey) && !isKnockedOut(prey) && isHostile(world, npc, prey);
}

function strips(world: World, npc: Vehicle, prey: Vehicle): boolean {
  return wantsLoot(world, npc, prey) && hasStrippable(prey);
}

export function offersGiveUp(world: World, npc: Vehicle): boolean {
  return hasStrandedPrey(world, npc) && !strips(world, npc, playerVehicle(world));
}

export function judgeStrandedFoe(world: World, npc: Vehicle): void {
  const prey = strandedPrey(world, npc);
  if (!prey || `strandedFoe:${prey.id}` in npc.brain!.noticed) return;
  npc.brain!.noticed[`strandedFoe:${prey.id}`] = world.turn;
  const robs = strips(world, npc, prey);
  if (!robs && decide(world, npc, 'strandedFoe', prey.id, null) === 'spare') return spare(world, npc, prey);
  if (prey.brain) answerOffer(world, prey, npc, robs);
}

function spare(world: World, npc: Vehicle, prey: Vehicle): void {
  if (!prey.brain) world.events.push({ t: 'say', speaker: npc.id, text: SPARE_LINE, vars: {} });
  makePeace(world, npc, prey);
}

export function answersSurrender(world: World, prey: Vehicle, winner: Vehicle): boolean {
  prey.brain!.noticed[`surrenderOffered:${winner.id}`] = world.turn;
  return decide(world, prey, 'surrenderOffered', winner.id, null) === 'accept';
}

export function offeredSurrenderBy(world: World, prey: Vehicle, winner: Vehicle): boolean {
  return `surrenderOffered:${winner.id}` in (prey.brain?.noticed ?? {});
}

function answerOffer(world: World, prey: Vehicle, winner: Vehicle, robs: boolean): void {
  if (!answersSurrender(world, prey, winner)) return;
  if (robs) surrenderTo(world, prey, winner);
  else giveUpTo(world, prey, winner);
}

export function judgedWorthOffer(world: World, npc: Vehicle): boolean {
  return `strandedFoe:${world.player.vehicleId}` in npc.brain!.noticed;
}

function removableParts(victim: Vehicle): PartItem[] {
  return victim.items
    .filter((item): item is PartItem => item.kind === 'part' && isMounted(victim.chassisId, item) && takeError(victim, item) === null)
    .sort((a, b) => partSellPrice(b.part) - partSellPrice(a.part));
}

export function hasStrippable(victim: Vehicle): boolean {
  return hasCargo(victim) || removableParts(victim).length > 0;
}

function dumpWantedParts(world: World, victim: Vehicle): SalvageStock | null {
  let pile: SalvageStock | null = null;
  for (let taken = 0; taken < RULES.surrenderParts; taken++) {
    const best = removableParts(victim)[0];
    if (!best) break;
    pile = dumpOnPile(world, victim, best);
  }
  if (pile) applyRefitLayout(world, victim, victim.items);
  return pile;
}

function refusedOffer(world: World, shooter: Vehicle, prey: Vehicle): boolean {
  if (prey.brain) return offeredSurrenderBy(world, prey, shooter);
  const talked = world.player.talked[shooter.id];
  return talked?.surrender === 'refused' || talked?.giveUp === 'refused';
}

export function aimAt(world: World, shooter: Vehicle, target: Vehicle): Aim {
  if (strandedPrey(world, shooter)?.id !== target.id) return 'body';
  return refusedOffer(world, shooter, target) ? corePart(target, 'cab').id : 'body';
}
