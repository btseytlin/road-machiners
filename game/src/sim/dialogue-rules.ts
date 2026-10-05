// The logic behind dialogue topics: named conditions, effects and prepare steps that src/data/dialogue.ts
// refers to. The records are typed complete, so a name in the data without a function fails typecheck.

import type { ConditionId, EffectId, PrepareId } from '../data/dialogue';
import { TRADE_TIP } from '../data/npcs';
import { PERK_NUMBERS } from '../data/skills';
import { REGION, type TownDef } from '../data/region';
import { playerVehicle } from './damage';
import { discoverSite } from './locations';
import { inCombat, isHostile } from './combat';
import { patchGoal, startTow, topGoal } from './npc-activities';
import { goodValue, priceAtPressure, standingPrice, vehicleValue } from './market';
import { recall } from './memory';
import { hasPerk, practice } from './progress';
import { abandonSpill, answerPlea, standDownBeggar, backOffClaims, defyClaims, guardsClaim, answersPlea, answersSurrender, offeredSurrenderBy, answersThreat, answersWarning, giveUpTo, hasStrandedPrey, hasStrippable, judgedWorthOffer, lootsBesidePlayer, makePeace, offersGiveUp, pendingPlea, playerPleaded, settlePlayerPlea, settleThreat, settleWarning, spillClaimOn, standDownTo, surrenderTo, yieldTo, type ThreatAnswer, type WarnAnswer } from './parley';
import { hasCargo, hasSalvage } from './salvage';
import { agreePatch, canFixItself, needsPatch, patchTerms } from './patch';
import { decide, isWeak, npcProfile, wantsLoot } from './npc-decisions';
import { isStranded } from './stats';
import { aidData, stateOf, towData } from './states';
import { agreeAid, aidPrice, canSpareFor, hasAid, isLow, playerAid, refuseAid, spareAid, wantedAid, type AidAmounts } from './aid';
import { spread, startTrade, tradeWith, transfer } from './economy';
import { acceptOffer, canTowNpc, hitchNpc, isOnRope, npcTowTerms, playerTow, playerTowing, refuseOffer, releaseNpc, strandedPlayerAt } from './tow';
import type { Call, CallVar, CallVars, MemoryFact, NpcState, Plea, SalvageStock, TopicOutcome, Vehicle, World } from './types';
import { bearing, dist, type Vec } from './vec';

// The top goal is a fight on the player that rolled a demand, and the player has cargo.
function demandsOnTop(world: World, npc: Vehicle): boolean {
  const top = topGoal(npc);
  return top?.kind === 'fight' && top.targetId === world.player.vehicleId && top.demands === true && hasCargo(playerVehicle(world));
}

// `vars` are the call values, empty on the hub and before a topic's prepare step.
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

// The known town nearest the player, not the NPC: directions are for the one asking.
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

// The rolled answer a line waits on, or null before the topic's prepare step.
function answerOf(vars: CallVars): string | null {
  const v = vars.answer;
  if (v === undefined) return null;
  if (v.kind !== 'answer') throw new Error(`The answer value holds a ${v.kind}`);
  return v.option;
}

// The plea the player makes in the open topic.
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

// A truck already in a patch deal, as patcher or client.
function inPatch(world: World, id: string): boolean {
  return world.states.some((s) => s.kind === 'patch' && (s.holder === id || s.other === id));
}

// The open offer this driver made to the player, or null.
function offerBy(world: World, npc: Vehicle) {
  const tow = playerTow(world);
  return tow?.holder === npc.id && !towData(tow).hitched ? tow : null;
}

// Something a driver can tell of with the Rumor mill perk: an undiscovered site, or a wreck stock the player has not
// searched or heard of that still holds loot. `site` is null for a wreck.
type Rumor = { id: string; pos: Vec; site: { id: string; name: string } | null };

function isRumorWreck(world: World, stock: SalvageStock): boolean {
  const { scavenged, rumored } = world.player;
  return stock.id.startsWith('wreck') && !scavenged.includes(stock.id) && !rumored.includes(stock.id) && hasSalvage(stock);
}

// The rumor nearest the driver within its radius, ties broken by id, or null. Nothing here rolls.
function heardRumor(world: World, npc: Vehicle): Rumor | null {
  const sites = [...REGION.towns, ...REGION.locations].filter((s) => !world.player.discovered.includes(s.id)).map((s) => ({ id: s.id, pos: s.pos, site: s }));
  const wrecks = world.salvage.filter((s) => isRumorWreck(world, s)).map((s) => ({ id: s.id, pos: s.pos, site: null }));
  const near = [...sites, ...wrecks].filter((r) => dist(npc.pos, r.pos) <= PERK_NUMBERS.rumorMill.radius);
  near.sort((a, b) => dist(npc.pos, a.pos) - dist(npc.pos, b.pos) || (a.id < b.id ? -1 : 1));
  return near[0] ?? null;
}

// What a driver tells about prices comes only from what it remembers of its last visits, never the live shop state,
// so the prices are as they were when it left and fade with the memory.
type PriceFact = Extract<MemoryFact, { kind: 'prices' }>;

// The driver's newest price memory of a town, or null.
function lastTownMemory(npc: Vehicle): PriceFact | null {
  const memory = recall(npc, 'prices').find((m) => REGION.towns.some((t) => t.id === m.fact.shop));
  return memory?.fact ?? null;
}

// The buy and sell prices the player would have met at the remembered pressure, at the player's spread now.
function rememberedPrices(world: World, fact: PriceFact): { good: string; buy: number; sell: number }[] {
  const margin = spread(world);
  return Object.entries(fact.pressure).map(([good, pressure]) => ({
    good,
    buy: priceAtPressure(fact.shop, good, pressure, 'buy', margin),
    sell: priceAtPressure(fact.shop, good, pressure, 'sell', margin),
  }));
}

type TradeTip = { shop: string; good: string; dear: boolean };

// Every remembered price as a share off its good's value, newest memory first, then by good id. The share is of the
// standing price before spread, rounded so goods with the same price factor tie exactly.
function rememberedOffsets(npc: Vehicle): (TradeTip & { off: number })[] {
  return recall(npc, 'prices').flatMap(({ fact }) => Object.keys(fact.pressure).sort().map((good) => {
    const ratio = standingPrice(fact.shop, good, fact.pressure[good]) / goodValue(good);
    return { shop: fact.shop, good, dear: ratio > 1, off: Math.round(Math.abs(ratio - 1) * 1e6) / 1e6 };
  }));
}

// The remembered price furthest off its good's value, when at least TRADE_TIP.share off. Ties go to the newer
// memory, then the good id. Nothing here rolls.
function tradeTip(npc: Vehicle): TradeTip | null {
  const best = rememberedOffsets(npc).filter((c) => c.off >= TRADE_TIP.share).reduce<(TradeTip & { off: number }) | null>((top, c) => (!top || c.off > top.off ? c : top), null);
  return best && { shop: best.shop, good: best.good, dear: best.dear };
}

function trucePrice(npc: Vehicle): number {
  return Math.round(vehicleValue(npc) * PERK_NUMBERS.paidTruce.share);
}

function aidVar(a: AidAmounts): CallVar {
  return { kind: 'aid', fuel: a.fuel, supplies: a.supplies };
}

// The fuel and supplies the open topic named.
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

// The aid offer this driver made the player and the player has not answered, or null.
function pendingAid(world: World, npc: Vehicle): NpcState | null {
  const s = stateOf(world, 'aid', npc.id, world.player.vehicleId);
  return s && !aidData(s).agreed ? s : null;
}

function requirePendingAid(world: World, npc: Vehicle): NpcState {
  const s = pendingAid(world, npc);
  if (!s) throw new Error(`${npc.id} has no aid offer pending`);
  return s;
}

// A driver asked for aid gives only when it can spare some, so the roll never sees an unavailable give.
function aidAnswer(world: World, npc: Vehicle): CallVars {
  const gives = canSpareFor(world, npc) && decide(world, npc, 'aidAsked', world.player.vehicleId, null) === 'give';
  if (!gives) return { answer: { kind: 'answer', option: 'refuse' } };
  return { answer: { kind: 'answer', option: 'give' }, aid: aidVar(spareAid(world, npc)) };
}

export const CONDITIONS: Record<ConditionId, Condition> = {
  knowsTown: (_world, npc) => knownTowns(npc).length > 0,
  offersPaidTow: (world, npc) => {
    const tow = offerBy(world, npc);
    return tow !== null && towData(tow).fee > 0;
  },
  offersFreeTow: (world, npc) => {
    const tow = offerBy(world, npc);
    return tow !== null && towData(tow).fee === 0;
  },
  // A driver already on its way does not need asking.
  canTowPlayer: (world, npc) => strandedPlayerAt(world, npc) !== null && topGoal(npc)?.kind !== 'tow',
  playerNeedsPatch: (world) => needsPatch(world, playerVehicle(world)) && !inPatch(world, world.player.vehicleId),
  npcNeedsPatch: (world, npc) => needsPatch(world, npc) && !canFixItself(world, npc) && !inPatch(world, npc.id),
  // A towed truck is already being helped. Its tower owns it.
  npcOffRope: (world, npc) => !isOnRope(world, npc.id),
  noTrade: (world, npc) => tradeWith(world, npc) === null,
  // A driver under attack takes on no tow, patch or trade.
  npcCalm: (world, npc) => !inCombat(world, npc),
  hasDeal: (_world, _npc, vars) => vars.deal !== undefined,
  noDeal: (_world, _npc, vars) => vars.deal === undefined,
  // About to attack the player, who carries something worth taking, and chose to call first.
  demandsCargo: (world, npc) => !isStranded(world, npc) && !hasStrandedPrey(world, npc) && demandsOnTop(world, npc),
  // The stranded player is alone with a robber and has cargo or parts to lose.
  demandsSurrender: (world, npc) => hasStrandedPrey(world, npc) && wantsLoot(world, npc, playerVehicle(world)) && hasStrippable(playerVehicle(world)),
  // The stranded player is alone with a driver that takes nothing: not a robber, or a robber with nothing to take.
  demandsGiveUp: (world, npc) => offersGiveUp(world, npc) && judgedWorthOffer(world, npc),
  // The foe is badly broken, and has not yet answered the player's demand to give up.
  npcBeaten: (world, npc) => isWeak(world, npc),
  notOfferedYield: (world, npc) => !offeredSurrenderBy(world, npc, playerVehicle(world)),
  guardsClaim: (world, npc) => guardsClaim(world, npc),
  claimsSpill: (world, npc) => spillClaimOn(world, npc) !== null,
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
  // Loots a wreck or knocked-out truck the player truck is in reach of too.
  claimsPlayerLoot: (world, npc) => lootsBesidePlayer(world, npc),
  holdsOn: (_world, _npc, vars) => answerOf(vars) === 'refuse',
  canTowNpc: (world, npc) => canTowNpc(world, npc),
  towedByPlayer: (world, npc) => playerTowing(world)?.other === npc.id,
  knowsLastTown: (world, npc) => hasPerk(world, 'marketEars') && lastTownMemory(npc) !== null,
  hearsRumor: (world, npc) => hasPerk(world, 'rumorMill') && heardRumor(world, npc) !== null,
  rumorOfSite: (_world, _npc, vars) => vars.site !== undefined,
  rumorOfWreck: (_world, _npc, vars) => vars.site === undefined,
  canPayTruce: (world, npc) => hasPerk(world, 'paidTruce') && world.player.money >= trucePrice(npc),
  // Low on fuel or supplies, and the player holds some of what it lacks.
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
  // A handover and a threat end at once, so they practice social now. A patch practices when it is done.
  handOver: (world, npc, call) => {
    yieldTo(world, playerVehicle(world), npc);
    settle(world, npc, call, 'agreed');
    practice(world, 'deal', 1, null, npc.id);
  },
  abandonSpill: (world, npc, call) => {
    const stock = spillClaimOn(world, npc);
    if (!stock) throw new Error(`${npc.id} claims no spilled cargo of the player`);
    abandonSpill(world, playerVehicle(world), npc, stock);
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
  // The only effect that fills call values: the beggar's answer is rolled when the player asks, so taking the cargo never notes the offer.
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
  // A warning pays no XP: the wreck it wins is its own reward.
  settleWarning: (world, npc, call) => {
    const answer = warnAnswer(call);
    settleWarning(world, npc, answer);
    settle(world, npc, call, answer === 'comply' ? 'agreed' : 'refused');
  },
  // The call holds no turn, so the rumor is the one the prepare step told.
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
  // The agreed terms are the pending offer's own.
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
  // No `deal` value means the driver cannot offer a patch.
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
    const memory = lastTownMemory(npc);
    if (!memory) throw new Error(`${npc.id} remembers no town`);
    const town = memory.shop;
    return { town: { kind: 'town', id: town }, prices: { kind: 'prices', town, goods: rememberedPrices(world, memory) } };
  },
  // Bearing and distance are from the player, like directions.
  nearestRumor: (world, npc): CallVars => {
    const rumor = heardRumor(world, npc);
    if (!rumor) throw new Error(`${npc.id} knows no rumor`);
    const me = playerVehicle(world).pos;
    const where: CallVars = { bearing: { kind: 'bearing', rad: bearing(me, rumor.pos) }, distance: { kind: 'distance', tiles: dist(me, rumor.pos) } };
    return rumor.site ? { site: { kind: 'site', id: rumor.id }, ...where } : where;
  },
  tradeTip: (_world, npc) => ({ tip: { kind: 'tip', tip: tradeTip(npc) } }),
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
