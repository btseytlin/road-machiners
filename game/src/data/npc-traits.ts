// NPC traits: the sites a driver knows, how it judges danger, what it may spend on a trade, and how it shifts the
// weights of its decisions. Templates in npcs.ts name the traits their drivers hold.

import { STALL_MARKETS, TOWN_MARKETS } from './market';
import type { TraitId, TraitWeights } from './npcs';

export type Trait = {
  towns: string[];
  bases: string[];
  markets: string[];
  salvageSites: string[];
  travelSites: string[];
  haulSites: string[];
  contactReactRadius: number;
  boldness: number;
  fuelMargin: number;
  robs: 'offDuty' | 'never';
  tradeStake: number;
  weights: TraitWeights;
};

const BASE_TRADE_STAKE = 20000;

export const TRAITS: Record<TraitId, Trait> = {
  scavenger: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: ['fallen-sun', 'orchard', 'glass-flats'], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: { idle: { scavenge: { add: 10 } }, salvageSeen: { loot: { add: 3 } }, strandedSeen: { tow: { add: 9 } }, hostileSeen: { fight: { add: 2 } }, aidAsked: { give: { mul: 2 } }, needySeen: { aid: { add: 0.02 } } },
  },
  trader: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], travelSites: [], haulSites: ['pump-station'], contactReactRadius: 12, boldness: 1, fuelMargin: 0.75, robs: 'offDuty', tradeStake: 83300,
    weights: {
      idle: { trade: { add: 30 }, haul: { add: 1 } }, strandedSeen: { tow: { add: 9 } },
      hostileSeen: { fight: { mul: 0.002 } }, attacked: { fightBack: { mul: 0.1 } }, ramChance: { ram: { mul: 0.001 } },
      crashed: { retaliate: { mul: 0.2 } }, parley: { truce: { add: 2 } }, truceOffered: { accept: { add: 4 } },
      mercyBegged: { spare: { add: 3 } }, threatened: { comply: { add: 1 }, fightBack: { mul: 0.1 } }, warnedOff: { comply: { add: 1 }, fightBack: { mul: 0.1 } },
      escortSeen: { hire: { add: 1 } }, aidAsked: { give: { mul: 2 } }, needySeen: { aid: { add: 0.02 } },
    },
  },
  raider: {
    towns: ['bowl', 'nose'], bases: ['scrapjaw', 'kiln'], markets: ['scrapjaw', 'kiln', 'salvage-yard'], salvageSites: [], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: {
      idle: { raid: { add: 9 }, patrol: { add: 6 } }, contactHeard: { investigate: { add: 10.8 } }, hostileSeen: { fight: { add: 7.2 } }, strandedSeen: { tow: { add: 9 } },
      crashed: { retaliate: { add: 3 } }, parley: { truce: { mul: 0.3 }, beg: { mul: 0.3 } }, truceOffered: { refuse: { add: 2 } },
      mercyBegged: { finish: { add: 2 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  scumbag: { towns: [], bases: [], markets: STALL_MARKETS, salvageSites: [], travelSites: [], haulSites: [], contactReactRadius: 0, boldness: 1.3, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE, weights: { preySeen: { rob: { add: 0.45 } }, crashed: { retaliate: { add: 1 } } } },
  coward: {
    towns: [], bases: [], markets: STALL_MARKETS, salvageSites: [], travelSites: [], haulSites: [], contactReactRadius: 0, boldness: 0.6, fuelMargin: 1.4, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: {
      hostileSeen: { flee: { mul: 3 }, fight: { mul: 0.5 } }, attacked: { flee: { mul: 3 }, fightBack: { mul: 0.3 } },
      parley: { truce: { mul: 2 }, beg: { mul: 3 } }, threatened: { flee: { mul: 3 }, comply: { add: 1 } }, warnedOff: { comply: { add: 1 } },
      escortSeen: { hire: { mul: 3 } }, fightWhim: { veer: { mul: 3 } },
    },
  },
  lawman: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'never', tradeStake: BASE_TRADE_STAKE,
    weights: {
      idle: { patrol: { add: 20 }, wait: { add: 2 }, scavenge: { mul: 0.05 } },
      hostileSeen: { fight: { add: 8 } }, attacked: { fightBack: { mul: 2 } }, strandedSeen: { tow: { add: 9 } },
      parley: { truce: { mul: 0.3 }, beg: { mul: 0.3 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  courier: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], travelSites: ['bowl', 'nose', 'orchard', 'dustwell', 'granary', 'glass-flats', 'green-pit', 'pump-station', 'fallen-sun', 'salvage-yard'],
    haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: {
      idle: { travel: { add: 20 }, scavenge: { mul: 0.001 } }, strandedSeen: { tow: { add: 2 } },
      hostileSeen: { fight: { mul: 0.1 } }, threatened: { comply: { add: 1 } }, warnedOff: { comply: { add: 1 } }, escortSeen: { hire: { add: 0.5 } },
    },
  },
  roamer: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: ['fallen-sun', 'orchard', 'glass-flats'], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: { idle: { explore: { add: 10 }, trade: { add: 3 }, scavenge: { add: 2 } }, salvageSeen: { loot: { add: 3 } }, strandedSeen: { tow: { add: 3 } }, escortSeen: { hire: { add: 0.2 } }, aidAsked: { give: { mul: 2 } }, needySeen: { aid: { add: 0.02 } } },
  },
  vulture: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: ['fallen-sun', 'orchard', 'glass-flats'], travelSites: [], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: { idle: { prowl: { add: 10 }, scavenge: { add: 2 } }, salvageSeen: { loot: { add: 20 } }, crashed: { retaliate: { add: 0.5 } } },
  },
  supplier: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], travelSites: [], haulSites: ['pump-station'], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'never', tradeStake: 83300,
    weights: {
      idle: { haul: { add: 30 }, trade: { add: 15 }, scavenge: { mul: 0.001 } }, strandedSeen: { tow: { add: 9 } },
      hostileSeen: { fight: { mul: 0.002 } }, attacked: { fightBack: { mul: 0.1 } }, threatened: { comply: { add: 1 }, fightBack: { mul: 0.1 } }, warnedOff: { comply: { add: 1 }, fightBack: { mul: 0.1 } },
    },
  },
  guard: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], travelSites: ['bowl', 'nose'], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'never', tradeStake: BASE_TRADE_STAKE,
    weights: {
      idle: { escort: { add: 30 }, wait: { add: 5 }, travel: { add: 1 }, scavenge: { mul: 0.001 } },
      hostileSeen: { fight: { add: 8 } }, attacked: { fightBack: { mul: 2 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  merc: {
    towns: ['bowl', 'nose'], bases: [], markets: TOWN_MARKETS, salvageSites: [], travelSites: ['bowl', 'nose'], haulSites: [], contactReactRadius: 12, boldness: 1, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: {
      idle: { wait: { add: 10 }, travel: { add: 1 }, scavenge: { mul: 0.001 } },
      hostileSeen: { fight: { add: 4 } }, attacked: { fightBack: { mul: 2 } }, threatened: { comply: { mul: 0.2 }, fightBack: { add: 2 } }, warnedOff: { comply: { mul: 0.2 }, fightBack: { add: 2 } },
    },
  },
  brave: {
    towns: [], bases: [], markets: STALL_MARKETS, salvageSites: [], travelSites: [], haulSites: [], contactReactRadius: 0, boldness: 1.5, fuelMargin: 1, robs: 'offDuty', tradeStake: BASE_TRADE_STAKE,
    weights: {
      hostileSeen: { flee: { mul: 0.05 } }, contactHeard: { flee: { mul: 0.05 } }, attacked: { flee: { mul: 0.05 } },
      parley: { truce: { mul: 0.05 }, beg: { mul: 0.05 } }, threatened: { flee: { mul: 0.05 }, comply: { mul: 0.05 } }, warnedOff: { comply: { mul: 0.05 } },
      fightWhim: { rush: { mul: 3 } },
    },
  },
};
