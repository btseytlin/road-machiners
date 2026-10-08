// NPC traits: the sites a driver knows, how it judges danger, what it may spend on a trade, and how it shifts the
// weights of its decisions. Templates in npcs.ts name the traits their drivers hold.

import { STALL_MARKETS, TOWN_MARKETS } from './market';
import type { TraitId, TraitWeights } from './npcs';

export type Trait = {
  towns: string[];
  bases: string[]; // own camps that give fuel, supplies and repairs instead of towns
  markets: string[]; // shops and camps where the driver sells cargo
  salvageSites: string[];
  supplySites: string[];
  travelSites: string[]; // sites the driver makes trips between
  haulSites: string[]; // sources in GOOD_SOURCES where the driver loads free cargo
  // A contact is useful only while its circle is at most this many tiles wide. A vague distant sound stays audible
  // without redirecting the driver. Scanner and beacon circles stay tight, so they stay useful from farther away.
  contactReactRadius: number;
  // Multiplies the driver's own danger when it judges another truck, for robbing and for fight or flee.
  // Traits multiply together. 1 judges trucks as they are.
  boldness: number;
  // Multiplies the fuel reserve the driver keeps for the way to a pump. Traits multiply together. See
  // NPC_UPKEEP.fuelReserve.
  fuelMargin: number;
  // When the driver may rob. 'never' wins over 'offDuty' across traits. 'offDuty' forbids robbing while the
  // driver follows a leader, so a follower on duty never robs and its leader still can.
  robs: 'offDuty' | 'never';
  // The most money the driver spends on one trade load. Traits take the highest. It bounds the cargo a robber can
  // take from one driver and the price pressure of one load.
  tradeStake: number;
  weights: TraitWeights;
};

// The stake of drivers who seldom trade: what a starting wallet of NPC_RESOURCES.money holds above an upkeep reserve,
// so their loads stay as they were before stakes.
const BASE_TRADE_STAKE = 20000;

// An NPC knows the union of its traits' sites.
export const TRAITS: Record<TraitId, Trait> = {
  // Scavenging a known site beats waiting a hundredfold. Three in four scavengers stop for a wreck they pass. Nine
  // in ten scavengers help a stranded truck. An idle scavenger takes on a manageable hostile about nine times in
  // ten: fight 4, times NPC_BEHAVIOR.manageableFight. Scavengers are helpers who give aid: about one in five gives fuel
  // or supplies when asked, and about one in 35 offers it unprompted to a poor, low player.
  scavenger: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: ['burnt-convoy', 'podfield', 'ridge-wrecks', 'fallen-sun', 'orchard', 'glass-flats'], supplySites: ['dustwell', 'green-pit'], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: { idle: { scavenge: { add: 10 } }, salvageSeen: { loot: { add: 3 } }, strandedSeen: { tow: { add: 9 } }, hostileSeen: { fight: { add: 2 } }, aidAsked: { give: { mul: 2 } }, needySeen: { aid: { add: 0.02 } } },
  },
  // Traders rarely pick a fight: a fight weight of 2 drops to 0.004, about 1%, and to 0.02, about 2%, against a
  // manageable hostile. A shot trader returns fire at a tenth of the usual weight, and mostly runs. A trader in a
  // fight rams about 1 time in 100: a ram weight of 9 drops to 0.009. Trading beats
  // salvage in sight 3 to 1. Nine in ten traders help a stranded truck. Traders want peace: they shrug off 19
  // crashes in 20, ask for truces, take nearly every truce and spare a beaten foe. Threatened or warned off a wreck, they mostly give way.
  // A trader on its way hires about one free merc in two it sees. Traders push on for one more deal, so they keep
  // a quarter less fuel for the way to a pump. A trader too poor for any trade hauls free cargo to earn a stake: a
  // haul weight of 1 loses to trade 30 whenever a trade is affordable. One load costs at most the trade stake of 83300 cents (833 M),
  // under two thirds of the starting wallet. About one trader in five gives fuel or supplies
  // when asked, and about one in 35 offers it unprompted to a poor, low player.
  trader: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: ['dustwell', 'green-pit'], travelSites: [], haulSites: ['pump-station', 'dustwell', 'green-pit'], contactReactRadius: 12, boldness: 1, fuelMargin: 0.75, robs: 'offDuty', tradeStake: 83300,
    weights: {
      idle: { trade: { add: 30 }, haul: { add: 1 } }, strandedSeen: { tow: { add: 9 } },
      hostileSeen: { fight: { mul: 0.002 } }, attacked: { fightBack: { mul: 0.1 } }, ramChance: { ram: { mul: 0.001 } },
      crashed: { retaliate: { mul: 0.2 } }, parley: { truce: { add: 2 } }, truceOffered: { accept: { add: 4 } },
      mercyBegged: { spare: { add: 3 } }, threatened: { comply: { add: 1 }, fightBack: { mul: 0.1 } }, warnedOff: { comply: { add: 1 }, fightBack: { mul: 0.1 } },
      escortSeen: { hire: { add: 1 } }, aidAsked: { give: { mul: 2 } }, needySeen: { aid: { add: 0.02 } },
    },
  },
  // Raiders fight most hostiles they see and close in on most useful contacts. A raid ties with salvage in sight. An idle raider raids about three times in five and patrols the roads around its camp otherwise.
  // A raider answers half the crashes with a fight, seldom asks for peace and refuses a truce more often than not,
  // and nearly always from prey it expects to beat. Threatened or warned off a wreck, it mostly fights. Nine in ten raiders help a stranded
  // raider, the only truck they tow.
  raider: {
    towns: ['bowl', 'nose'], bases: ['scrapjaw', 'kiln'], markets: ['scrapjaw', 'kiln', 'salvage-yard'], salvageSites: [], supplySites: [], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: {
      idle: { raid: { add: 9 }, patrol: { add: 6 } }, contactHeard: { investigate: { add: 10.8 } }, hostileSeen: { fight: { add: 7.2 } }, strandedSeen: { tow: { add: 9 } },
      crashed: { retaliate: { add: 3 } }, parley: { truce: { mul: 0.3 }, beg: { mul: 0.3 } }, truceOffered: { refuse: { add: 2 } },
      mercyBegged: { finish: { add: 2 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  // A scumbag robs about one target in three it comes across: rob 0.5 against keep 1. Boldness 1.3 lets it rob a
  // truck that looks as dangerous as its own, and stand against one up to 30% stronger. It answers a crash with a
  // fight twice as often as most drivers.
  scumbag: { towns: [], bases: [], markets: STALL_MARKETS, salvageSites: [], supplySites: [], travelSites: [], haulSites: [], contactReactRadius: 0, boldness: 1.3, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE, weights: { preySeen: { rob: { add: 0.45 } }, crashed: { retaliate: { add: 1 } } } },
  // A coward veers off three times as often in a fight. It runs three times as often from a new hostile or a shot, picks a fight half as often, and shoots back
  // at a third of the weight. Boldness 0.6 makes a truck that looks as dangerous as its own a threat, even at the
  // lowest misjudgment. It asks for a truce twice as often and begs three times as often. Threatened, it runs or
  // pays, and warned off a wreck, it backs off more often. It hires a merc three times as readily. It keeps 40% more fuel for the way home.
  coward: {
    towns: [], bases: [], markets: STALL_MARKETS, salvageSites: [], supplySites: [], travelSites: [], haulSites: [], contactReactRadius: 0, boldness: 0.6, fuelMargin: 1.4, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: {
      hostileSeen: { flee: { mul: 3 }, fight: { mul: 0.5 } }, attacked: { flee: { mul: 3 }, fightBack: { mul: 0.3 } },
      parley: { truce: { mul: 2 }, beg: { mul: 3 } }, threatened: { flee: { mul: 3 }, comply: { add: 1 } }, warnedOff: { comply: { add: 1 } },
      escortSeen: { hire: { mul: 3 } }, fightWhim: { veer: { mul: 3 } },
    },
  },
  // Lawmen patrol their town and hunt raiders and first shooters at neutral NPCs. They fight most hostiles they
  // see, as eager as raiders, and shoot back twice as often as most drivers. They seldom ask for a truce or beg.
  // Threatened or warned off a wreck, they mostly fight. Nine in ten lawmen help a stranded truck, like traders. An idle lawman patrols
  // about nine times in ten and waits a turn otherwise. Salvage in sight tempts it about one time in fifty. A lawman
  // never robs.
  lawman: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: [], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'never', tradeStake: BASE_TRADE_STAKE,
    weights: {
      idle: { patrol: { add: 20 }, wait: { add: 2 }, scavenge: { mul: 0.05 } },
      hostileSeen: { fight: { add: 8 } }, attacked: { fightBack: { mul: 2 } }, strandedSeen: { tow: { add: 9 } },
      parley: { truce: { mul: 0.3 }, beg: { mul: 0.3 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  // Couriers carry small loads between every town and location. An idle courier sets out on a trip nearly always.
  // Stopping for salvage on the way or at all stays at about the minimum chance: a scavenge weight of 1 drops to
  // 0.001. Two in three couriers help a stranded truck. A courier hires about one free merc in three it sees.
  courier: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: ['dustwell', 'green-pit'], travelSites: ['bowl', 'nose', 'orchard', 'dustwell', 'granary', 'burnt-convoy', 'podfield', 'canyon-bridge', 'glass-flats', 'green-pit', 'south-lock', 'ridge-wrecks', 'pump-station', 'fallen-sun', 'salvage-yard'],
    haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: {
      idle: { travel: { add: 20 }, scavenge: { mul: 0.001 } }, strandedSeen: { tow: { add: 2 } },
      hostileSeen: { fight: { mul: 0.1 } }, threatened: { comply: { add: 1 } }, warnedOff: { comply: { add: 1 } }, escortSeen: { hire: { add: 0.5 } },
    },
  },
  // Roamers go where nobody goes. An idle roamer explores about three times in five, and trades or scavenges about
  // one time in five each. Three in four roamers stop for salvage they pass, like scavengers. A roamer hires about
  // one free merc in six it sees. About one roamer in five gives fuel or supplies when asked, and about one in 35
  // offers it unprompted to a poor, low player.
  roamer: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: ['burnt-convoy', 'podfield', 'ridge-wrecks', 'fallen-sun', 'orchard', 'glass-flats'], supplySites: ['dustwell', 'green-pit'], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: { idle: { explore: { add: 10 }, trade: { add: 3 }, scavenge: { add: 2 } }, salvageSeen: { loot: { add: 3 } }, strandedSeen: { tow: { add: 3 } }, escortSeen: { hire: { add: 0.2 } }, aidAsked: { give: { mul: 2 } }, needySeen: { aid: { add: 0.02 } } },
  },
  // Vultures prowl lonely roads and hunting grounds: an idle vulture prowls four times in five and scavenges a site
  // about one time in six. Prowl 10 and scavenge 2 against a base of 1 keep other options at the minimum. A vulture
  // stops for 20 in 21 wrecks, piles and knocked-out trucks it passes, and rarely tows. Retaliate 0.5 against forgive
  // 4 makes it a bit touchier than most.
  vulture: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: ['burnt-convoy', 'podfield', 'ridge-wrecks', 'fallen-sun', 'orchard', 'glass-flats'], supplySites: ['dustwell', 'green-pit'], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: { idle: { prowl: { add: 10 }, scavenge: { add: 2 } }, salvageSeen: { loot: { add: 20 } }, crashed: { retaliate: { add: 0.5 } } },
  },
  // Supply convoys haul fuel drums from the Pump Station and water from the oases to the towns. An idle convoy
  // hauls about two trips in three and trades between towns on the side the third, haul 30 against trade 15. A trade
  // load costs at most the stake of 83300 cents (833 M). It stops for salvage only at about the minimum chance. Like traders, convoys
  // avoid fights and leave them to their guard, and mostly give way when threatened or warned off a wreck. A convoy
  // never robs.
  supplier: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: ['dustwell', 'green-pit'], travelSites: [], haulSites: ['pump-station', 'dustwell', 'green-pit'], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'never', tradeStake: 83300,
    weights: {
      idle: { haul: { add: 30 }, trade: { add: 15 }, scavenge: { mul: 0.001 } }, strandedSeen: { tow: { add: 9 } },
      hostileSeen: { fight: { mul: 0.002 } }, attacked: { fightBack: { mul: 0.1 } }, threatened: { comply: { add: 1 }, fightBack: { mul: 0.1 } }, warnedOff: { comply: { add: 1 }, fightBack: { mul: 0.1 } },
    },
  },
  // A convoy guard takes up an escort nearly always when it can. Otherwise it waits about 5 turns, then drives to the
  // other town, where convoys pass: wait 5 against a trip weight of 1. It fights like a lawman and never robs.
  guard: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: ['dustwell', 'green-pit'], travelSites: ['bowl', 'nose'], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'never', tradeStake: BASE_TRADE_STAKE,
    weights: {
      idle: { escort: { add: 30 }, wait: { add: 5 }, travel: { add: 1 }, scavenge: { mul: 0.001 } },
      hostileSeen: { fight: { add: 8 } }, attacked: { fightBack: { mul: 2 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  // A merc waits at a town pad for hire. A wait weight of 10 against a trip weight of 1 keeps it parked about 10
  // turns before it tries the other town. Waits stay far below NPC_BEHAVIOR.stallTurns. It trades and scavenges only at about the minimum
  // chance. It fights most hostiles it sees and shoots back twice as often as most drivers.
  merc: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], supplySites: ['dustwell', 'green-pit'], travelSites: ['bowl', 'nose'], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: {
      idle: { wait: { add: 10 }, travel: { add: 1 }, scavenge: { mul: 0.001 } },
      hostileSeen: { fight: { add: 4 } }, attacked: { fightBack: { mul: 2 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  // A brave driver almost never runs or gives up: flee, truce, beg and paying up drop to a twentieth of their
  // weight. It rushes its foe three times as often. Boldness 1.5 lets it stand against a group half again as strong as its own.
  brave: {
    towns: [], bases: [], markets: STALL_MARKETS, salvageSites: [], supplySites: [], travelSites: [], haulSites: [], contactReactRadius: 0, boldness: 1.5, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: {
      hostileSeen: { flee: { mul: 0.05 } }, contactHeard: { flee: { mul: 0.05 } }, attacked: { flee: { mul: 0.05 } },
      parley: { truce: { mul: 0.05 }, beg: { mul: 0.05 } }, threatened: { flee: { mul: 0.05 }, comply: { mul: 0.05 } }, warnedOff: { comply: { mul: 0.05 } },
      fightWhim: { rush: { mul: 3 } },
    },
  },
};
