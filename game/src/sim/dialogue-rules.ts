// The logic behind dialogue topics: named conditions, effects and prepare steps that src/data/dialogue.ts
// refers to. The records are typed complete, so a name in the data without a function fails typecheck.

import type { ConditionId, EffectId, PrepareId } from '../data/dialogue';
import { shopDef } from '../data/market';
import { PERK_NUMBERS } from '../data/skills';
import { REGION, type TownDef } from '../data/region';
import { playerVehicle } from './damage';
import { discoverSite } from './locations';
import { inCombat, isHostile } from './combat';
import { patchGoal, startTow, topGoal } from './npc-activities';
import { vehicleValue } from './market';
import { hasPerk, practice } from './progress';
import { answerPlea, standDownBeggar, backOffClaims, defyClaims, guardsClaim, answersPlea, answersSurrender, offeredSurrenderBy, answersThreat, answersWarning, giveUpTo, hasStrandedPrey, hasStrippable, judgedWorthOffer, lootsBesidePlayer, makePeace, offersGiveUp, pendingPlea, playerPleaded, settlePlayerPlea, settleThreat, settleWarning, standDownTo, surrenderTo, yieldTo, type ThreatAnswer, type WarnAnswer } from './parley';
import { hasCargo, hasSalvage } from './salvage';
import { agreePatch, canFixItself, needsPatch, patchTerms } from './patch';
import { decide, isWeak, npcProfile, wantsLoot } from './npc-decisions';
import { aidData, stateOf, towData } from './states';
import { agreeAid, aidPrice, canSpareFor, hasAid, isLow, playerAid, refuseAid, spareAid, wantedAid, type AidAmounts } from './aid';
import { buyPrice, sellPrice, startTrade, tradeWith, transfer } from './economy';
import { acceptOffer, canTowNpc, hitchNpc, isOnRope, npcTowTerms, playerTow, playerTowing, refuseOffer, releaseNpc, strandedPlayerAt } from './tow';
import type { Call, CallVar, CallVars, NpcState, Plea, SalvageStock, TopicOutcome, Vehicle, World } from './types';
import { bearing, dist, type Vec } from './vec';

export type Condition = (world: World, npc: Vehicle, vars: CallVars) => boolean;
export type Effect = (world: World, npc: Vehicle, call: Call) => void;
export type Prepare = (world: World, npc: Vehicle) => CallVars;

function knownTowns(npc: Vehicle): TownDef[] {
  return npcProfile(npc).towns.map((id) => {
    const town = REGION.towns.find((t) => t.id === id);
    if (!town) throw new Error(`Unknown town ${id}`);
    return town;
  });
}

function nearestKnownTown(world: World, npc: Vehicle): TownDef {
  const me = playerVehicle(world).pos;
  const towns = knownTowns(npc);
  if (towns.length === 0) throw new Error(`${npc.id} knows no town`);
  return towns.reduce((a, b) => (dist(me, a.pos) <= dist(me, b.pos) ? a : b));
}

function settle(world: World, npc: Vehicle, call: Call, outcome: TopicOutcome): void {
  if (!call.topic) throw new Error('Only a topic can be settled');
  world.player.talked[npc.id] = { ...world.player.talked[npc.id], [call.topic]: outcome };
}

function answerOf(vars: CallVars): string | null {
  const v = vars.answer;
  if (v === undefined) return null;
  if (v.kind !== 'answer') throw new Error(`The answer value holds a ${v.kind}`);
  return v.option;
}

function playerPlea(call: Call): Plea {
  if (call.topic === 'truce') return 'truce';
  if (call.topic === 'mercy') return 'mercy';
  throw new Error(`Topic ${call.topic} holds no plea`);
}

function threatAnswer(call: Call): ThreatAnswer {
  const option = answerOf(call.vars);
  if (option !== 'comply' && option !== 'fightBack' && option !== 'flee') throw new Error(`Bad threat answer ${option}`);
  return option;
}

function warnAnswer(call: Call): WarnAnswer {
  const option = answerOf(call.vars);
  if (option !== 'comply' && option !== 'refuse' && option !== 'fightBack') throw new Error(`Bad warning answer ${option}`);
  return option;
}

function inPatch(world: World, id: string): boolean {
  return world.states.some((s) => s.kind === 'patch' && (s.holder === id || s.other === id));
}

function offerBy(world: World, npc: Vehicle) {
  const tow = playerTow(world);
  return tow?.holder === npc.id && !towData(tow).hitched ? tow : null;
}

type Rumor = { id: string; pos: Vec; site: { id: string; name: string } | null };

function isRumorWreck(world: World, stock: SalvageStock): boolean {
  const { scavenged, rumored } = world.player;
  return stock.id.startsWith('wreck') && !scavenged.includes(stock.id) && !rumored.includes(stock.id) && hasSalvage(stock);
}

function heardRumor(world: World, npc: Vehicle): Rumor | null {
  const sites = [...REGION.towns, ...REGION.locations].filter((s) => !world.player.discovered.includes(s.id)).map((s) => ({ id: s.id, pos: s.pos, site: s }));
  const wrecks = world.salvage.filter((s) => isRumorWreck(world, s)).map((s) => ({ id: s.id, pos: s.pos, site: null }));
  const near = [...sites, ...wrecks].filter((r) => dist(npc.pos, r.pos) <= PERK_NUMBERS.rumorMill.radius);
  near.sort((a, b) => dist(npc.pos, a.pos) - dist(npc.pos, b.pos) || (a.id < b.id ? -1 : 1));
  return near[0] ?? null;
}

function trucePrice(npc: Vehicle): number {
  return Math.round(vehicleValue(npc) * PERK_NUMBERS.paidTruce.share);
}

function aidVar(a: AidAmounts): CallVar {
  return { kind: 'aid', fuel: a.fuel, supplies: a.supplies };
}

function namedAid(call: Call): AidAmounts {
  const v = call.vars.aid;
  if (v?.kind !== 'aid') throw new Error('The topic named no fuel or supplies');
  return { fuel: v.fuel, supplies: v.supplies };
}

function namedPrice(call: Call): number {
  const v = call.vars.price;
  if (v?.kind !== 'money') throw new Error('The topic named no price');
  return v.amount;
}

function pendingAid(world: World, npc: Vehicle): NpcState | null {
  const s = stateOf(world, 'aid', npc.id, world.player.vehicleId);
  return s && !aidData(s).agreed ? s : null;
}

function requirePendingAid(world: World, npc: Vehicle): NpcState {
  const s = pendingAid(world, npc);
  if (!s) throw new Error(`${npc.id} has no aid offer pending`);
  return s;
}

function aidAnswer(world: World, npc: Vehicle): CallVars {
  const gives = canSpareFor(world, npc) && decide(world, npc, 'aidAsked', world.player.vehicleId, null) === 'give';
  if (!gives) return { answer: { kind: 'answer', option: 'refuse' } };
  return { answer: { kind: 'answer', option: 'give' }, aid: aidVar(spareAid(world, npc)) };
}

export const CONDITIONS: Record<ConditionId, Condition> = {
  knowsTown: (_world, npc) => knownTowns(npc).length > 0,
  offersTow: (world, npc) => offerBy(world, npc) !== null,
  canTowPlayer: (world, npc) => strandedPlayerAt(world, npc) !== null && topGoal(npc)?.kind !== 'tow',
  playerNeedsPatch: (world) => needsPatch(world, playerVehicle(world)) && !inPatch(world, world.player.vehicleId),
  npcNeedsPatch: (world, npc) => needsPatch(world, npc) && !canFixItself(world, npc) && !inPatch(world, npc.id),
  npcOffRope: (world, npc) => !isOnRope(world, npc.id),
  noTrade: (world, npc) => tradeWith(world, npc) === null,
  npcCalm: (world, npc) => !inCombat(world, npc),
  hasDeal: (_world, _npc, vars) => vars.deal !== undefined,
  noDeal: (_world, _npc, vars) => vars.deal === undefined,
  demandsCargo: (world, npc) => {
    if (hasStrandedPrey(world, npc)) return false;
    const top = topGoal(npc);
    return top?.kind === 'fight' && top.targetId === world.player.vehicleId && top.demands === true && hasCargo(playerVehicle(world));
  },
  demandsSurrender: (world, npc) => hasStrandedPrey(world, npc) && wantsLoot(world, npc, playerVehicle(world)) && hasStrippable(playerVehicle(world)),
  demandsGiveUp: (world, npc) => offersGiveUp(world, npc) && judgedWorthOffer(world, npc),
  npcBeaten: (world, npc) => isWeak(world, npc),
  notOfferedYield: (world, npc) => !offeredSurrenderBy(world, npc, playerVehicle(world)),
  guardsClaim: (world, npc) => guardsClaim(world, npc),
  atOdds: (world, npc) => isHostile(world, npc, playerVehicle(world)),
  atPeace: (world, npc) => !isHostile(world, npc, playerVehicle(world)),
  noPlayerPlea: (world, npc) => !playerPleaded(world, npc),
  npcHasCargo: (_world, npc) => hasCargo(npc),
  offersTruce: (world, npc) => pendingPlea(world, npc) === 'truce',
  begsMercy: (world, npc) => pendingPlea(world, npc) === 'mercy',
  accepts: (_world, _npc, vars) => answerOf(vars) === 'yes',
  refuses: (_world, _npc, vars) => answerOf(vars) === 'no',
  complies: (_world, _npc, vars) => answerOf(vars) === 'comply',
  resists: (_world, _npc, vars) => answerOf(vars) === 'fightBack',
  runs: (_world, _npc, vars) => answerOf(vars) === 'flee',
  claimsPlayerLoot: (world, npc) => lootsBesidePlayer(world, npc),
  holdsOn: (_world, _npc, vars) => answerOf(vars) === 'refuse',
  canTowNpc: (world, npc) => canTowNpc(world, npc),
  towedByPlayer: (world, npc) => playerTowing(world)?.other === npc.id,
  knowsLastTown: (world, npc) => hasPerk(world, 'marketEars') && npc.brain?.lastTown !== undefined,
  hearsRumor: (world, npc) => hasPerk(world, 'rumorMill') && heardRumor(world, npc) !== null,
  rumorOfSite: (_world, _npc, vars) => vars.site !== undefined,
  rumorOfWreck: (_world, _npc, vars) => vars.site === undefined,
  canPayTruce: (world, npc) => hasPerk(world, 'paidTruce') && world.player.money >= trucePrice(npc),
  npcLow: (world, npc) => hasAid(wantedAid(world, npc)),
  playerLow: (world) => isLow(world, playerVehicle(world)),
  noAid: (world) => playerAid(world) === null,
  aidGiven: (_world, _npc, vars) => answerOf(vars) === 'give',
  aidRefused: (_world, _npc, vars) => answerOf(vars) === 'refuse',
  offersAid: (world, npc) => pendingAid(world, npc) !== null,
};

export const EFFECTS: Record<EffectId, Effect> = {
  revealTown: (world, _npc, call) => {
    const v = call.vars.town;
    if (v?.kind !== 'town') throw new Error('revealTown needs a town value');
    const town = REGION.towns.find((t) => t.id === v.id)!;
    if (!world.player.discovered.includes(town.id)) discoverSite(world, town);
  },
  acceptTow: (world) => acceptOffer(world),
  refuseTow: (world) => refuseOffer(world),
  askTow: (world, npc) => startTow(world, npc, playerVehicle(world), strandedPlayerAt(world, npc)!),
  startTrade: (world, npc) => startTrade(world, npc),
  agreePatch: (world, npc, call) => {
    const terms = call.vars.deal;
    if (terms?.kind !== 'deal') throw new Error('agreePatch needs deal terms');
    const deal = agreePatch(world, npc, terms);
    patchGoal(world, npc, playerVehicle(world), deal.holder === npc.id);
    settle(world, npc, call, 'agreed');
  },
  handOver: (world, npc, call) => {
    yieldTo(world, playerVehicle(world), npc);
    settle(world, npc, call, 'agreed');
    practice(world, 'deal', 1, null, npc.id);
  },
  surrender: (world, npc, call) => {
    surrenderTo(world, playerVehicle(world), npc);
    settle(world, npc, call, 'agreed');
    practice(world, 'deal', 1, null, npc.id);
  },
  yieldToPlayer: (world, npc, call) => {
    standDownTo(world, npc, playerVehicle(world));
    settle(world, npc, call, 'agreed');
    practice(world, 'deal', 1, null, npc.id);
  },
  askStandDown: (world, npc, call) => { call.vars = PREPARES.yieldAnswer(world, npc); },
  standDownPlea: (world, npc) => {
    standDownBeggar(world, npc);
    practice(world, 'deal', 1, null, npc.id);
  },
  giveUp: (world, npc, call) => {
    giveUpTo(world, playerVehicle(world), npc);
    settle(world, npc, call, 'agreed');
    practice(world, 'deal', 1, null, npc.id);
  },
  backOffClaim: (world, npc) => backOffClaims(world, npc),
  defyClaim: (world, npc, call) => {
    defyClaims(world, npc);
    settle(world, npc, call, 'refused');
  },
  acceptPlea: (world, npc) => answerPlea(world, npc, true),
  refusePlea: (world, npc) => answerPlea(world, npc, false),
  settlePlea: (world, npc, call) => settlePlayerPlea(world, npc, playerPlea(call), answerOf(call.vars) === 'yes'),
  withdrawPlea: (world, npc, call) => settlePlayerPlea(world, npc, playerPlea(call), false),
  hitchNpc: (world, npc) => hitchNpc(world, npc, false),
  hitchNpcFree: (world, npc) => hitchNpc(world, npc, true),
  releaseNpc: (world, npc) => releaseNpc(world, npc),
  settleThreat: (world, npc, call) => {
    const answer = threatAnswer(call);
    settleThreat(world, npc, answer);
    settle(world, npc, call, answer === 'comply' ? 'agreed' : 'refused');
    if (answer === 'comply') practice(world, 'deal', 1, null, npc.id);
  },
  settleWarning: (world, npc, call) => {
    const answer = warnAnswer(call);
    settleWarning(world, npc, answer);
    settle(world, npc, call, answer === 'comply' ? 'agreed' : 'refused');
  },
  revealRumor: (world, npc, call) => {
    const rumor = heardRumor(world, npc);
    if (!rumor || (rumor.site !== null) !== (call.vars.site !== undefined)) throw new Error(`${npc.id} has no rumor to reveal`);
    if (rumor.site) discoverSite(world, rumor.site);
    else world.player.rumored.push(rumor.id);
  },
  payTruce: (world, npc, call) => {
    const price = call.vars.price;
    if (price?.kind !== 'money') throw new Error('payTruce needs a price');
    transfer(world, playerVehicle(world), npc, price.amount);
    makePeace(world, playerVehicle(world), npc);
  },
  giveAidPaid: (world, npc, call) => { agreeAid(world, npc, { giver: 'player', ...namedAid(call), price: namedPrice(call), free: false }); },
  giveAidFree: (world, npc, call) => { agreeAid(world, npc, { giver: 'player', ...namedAid(call), price: 0, free: true }); },
  takeAid: (world, npc, call) => { agreeAid(world, npc, { giver: 'npc', ...namedAid(call), price: 0, free: true }); },
  acceptAidOffer: (world, npc) => {
    const { giver, fuel, supplies, price, free } = aidData(requirePendingAid(world, npc));
    agreeAid(world, npc, { giver, fuel, supplies, price, free });
  },
  refuseAidOffer: (world, npc) => refuseAid(world, npc),
  settleDone: (world, npc, call) => settle(world, npc, call, 'done'),
  settleRefused: (world, npc, call) => settle(world, npc, call, 'refused'),
};

export const PREPARES: Record<PrepareId, Prepare> = {
  truceAnswer: (world, npc) => ({ answer: { kind: 'answer', option: answersPlea(world, npc, playerVehicle(world), 'truce') ? 'yes' : 'no' } }),
  mercyAnswer: (world, npc) => ({ answer: { kind: 'answer', option: answersPlea(world, npc, playerVehicle(world), 'mercy') ? 'yes' : 'no' } }),
  yieldAnswer: (world, npc) => ({ answer: { kind: 'answer', option: answersSurrender(world, npc, playerVehicle(world)) ? 'yes' : 'no' } }),
  threatAnswer: (world, npc) => ({ answer: { kind: 'answer', option: answersThreat(world, npc) } }),
  warnAnswer: (world, npc) => ({ answer: { kind: 'answer', option: answersWarning(world, npc) } }),
  npcTowTerms: (world, npc) => {
    const { site, fee } = npcTowTerms(world, npc);
    return { site: { kind: 'site', id: site.id }, fee: { kind: 'money', amount: fee } };
  },
  patchTerms: (world, npc): CallVars => {
    const deal = patchTerms(world, npc);
    return deal ? { deal } : {};
  },
  towOffer: (world, npc) => {
    const tow = offerBy(world, npc);
    if (!tow) throw new Error(`${npc.id} made no tow offer`);
    const { site, fee } = towData(tow);
    return { town: { kind: 'town', id: site }, fee: { kind: 'money', amount: fee } };
  },
  lastTownPrices: (world, npc) => {
    const town = npc.brain?.lastTown;
    if (!town) throw new Error(`${npc.id} has been to no town`);
    const goods = shopDef(town).goods.map((good) => ({ good, buy: buyPrice(world, town, good), sell: sellPrice(world, town, good) }));
    return { town: { kind: 'town', id: town }, prices: { kind: 'prices', town, goods } };
  },
  nearestRumor: (world, npc): CallVars => {
    const rumor = heardRumor(world, npc);
    if (!rumor) throw new Error(`${npc.id} knows no rumor`);
    const me = playerVehicle(world).pos;
    const where: CallVars = { bearing: { kind: 'bearing', rad: bearing(me, rumor.pos) }, distance: { kind: 'distance', tiles: dist(me, rumor.pos) } };
    return rumor.site ? { site: { kind: 'site', id: rumor.id }, ...where } : where;
  },
  trucePrice: (_world, npc) => ({ price: { kind: 'money', amount: trucePrice(npc) } }),
  aidWanted: (world, npc) => {
    const wanted = wantedAid(world, npc);
    return { aid: aidVar(wanted), price: { kind: 'money', amount: aidPrice(world, npc, wanted) } };
  },
  aidAnswer,
  aidOffered: (world, npc) => ({ aid: aidVar(aidData(requirePendingAid(world, npc))) }),
  nearestTown: (world, npc) => {
    const me = playerVehicle(world).pos;
    const town = nearestKnownTown(world, npc);
    return {
      town: { kind: 'town', id: town.id },
      bearing: { kind: 'bearing', rad: bearing(me, town.pos) },
      distance: { kind: 'distance', tiles: dist(me, town.pos) },
    };
  },
};
