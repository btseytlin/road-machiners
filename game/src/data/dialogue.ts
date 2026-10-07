// Dialogue content: topics the player and NPCs talk about over the radio. A topic holds text and structure
// only. Its logic lives in the named conditions, effects and prepare steps of src/sim/dialogue-rules.ts.
// Lines are templates: `{name}` is filled from the call values the topic's prepare step made.

import { DETECT } from './detect';
import type { DecisionOptions, TraitId } from './npcs';

type PatchDeal = DecisionOptions['patchDeal'];

export type TopicId = 'directions' | 'tow' | 'towFree' | 'askTow' | 'patch' | 'patchRequest' | 'demand' | 'surrender' | 'giveUp' | 'claim' | 'trade' | 'truce' | 'mercy' | 'rob' | 'warnOff' | 'truceOffer' | 'mercyPlea' | 'offerTow' | 'releaseTow' | 'offerPatch' | 'offerPatchWorn' | 'marketNews' | 'rumor' | 'tips' | 'buyTruce' | 'offerAid' | 'askAid' | 'aidOffer' | 'yieldDemand' | 'spillClaim' | 'armyWagon';
export type ConditionId =
  | 'knowsTown' | 'offersPaidTow' | 'offersFreeTow' | 'canTowPlayer' | 'playerNeedsPatch' | 'npcNeedsPatch' | 'npcWorn' | 'npcOffRope' | 'hasDeal' | 'noDeal' | 'demandsCargo' | 'demandsSurrender' | 'demandsGiveUp' | 'guardsClaim'
  | 'atOdds' | 'atPeace' | 'noPlayerPlea' | 'demandsToll' | 'npcHasCargo' | 'offersTruce' | 'begsMercy'
  | 'accepts' | 'refuses' | 'complies' | 'resists' | 'runs' | 'claimsPlayerLoot' | 'holdsOn' | 'canTowNpc' | 'towedByPlayer' | 'noTrade' | 'npcCalm'
  | 'knowsLastTown' | 'hearsRumor' | 'rumorOfSite' | 'rumorOfWreck' | 'canPayTruce'
  | 'npcLow' | 'playerLow' | 'noAid' | 'aidGiven' | 'aidRefused' | 'offersAid' | 'npcBeaten' | 'notOfferedYield' | 'claimsSpill' | 'heardWagonNearby';
export type EffectId =
  | 'revealTown' | 'settleDone' | 'settleRefused' | 'acceptTow' | 'refuseTow' | 'askTow' | 'agreePatch' | 'handOver' | 'surrender' | 'giveUp' | 'backOffClaim' | 'defyClaim'
  | 'acceptPlea' | 'refusePlea' | 'settlePlea' | 'payToll' | 'refuseToll' | 'withdrawPlea' | 'settleThreat' | 'settleWarning' | 'hitchNpc' | 'hitchNpcFree' | 'releaseNpc' | 'startTrade'
  | 'revealRumor' | 'payTruce' | 'giveAidPaid' | 'giveAidFree' | 'takeAid' | 'acceptAidOffer' | 'refuseAidOffer' | 'yieldToPlayer' | 'askStandDown' | 'standDownPlea' | 'abandonSpill' | 'noteWagonRoad';
export type PrepareId = 'nearestTown' | 'towOffer' | 'patchTerms' | 'truceAnswer' | 'mercyAnswer' | 'threatAnswer' | 'warnAnswer' | 'npcTowTerms' | 'lastTownPrices' | 'nearestRumor' | 'tradeTip' | 'trucePrice' | 'aidWanted' | 'aidAnswer' | 'aidOffered' | 'yieldAnswer';

// `go` is a node of the same topic, the hub of topics, or the end of the call.
export type DialogueOption = { text: string; when: ConditionId[]; effects: EffectId[]; go: string };
export type DialogueNode = { line: string; options: DialogueOption[] };

export type Topic = {
  id: TopicId;
  once: boolean; // a driver raises or answers it with the player at most once
  // How the player raises it from the hub. A driver in a feud with the player takes up only topics asked during
  // feuds.
  ask: { text: string; when: ConditionId[]; duringFeud: boolean } | null;
  // When an NPC calls the player with it; higher priority wins. A feud stops the call unless `duringFeud`. A player
  // in combat takes only calls that are part of the fight, marked `duringCombat`.
  raise: { when: ConditionId[]; priority: number; duringFeud: boolean; duringCombat: boolean } | null;
  prepare: PrepareId | null; // fills the call values when the topic opens
  hangUp: EffectId[]; // runs when the player hangs up inside the topic
  start: string;
  nodes: Record<string, DialogueNode>;
};

export const HUB = 'hub';
export const END = 'end';
// The node, outside any topic, of a call the driver refused. It offers only hang up.
export const REFUSED = 'callRefused';
// What a driver busy fighting another truck says when the player calls.
export const BUSY_LINE = 'Busy here! Off the channel.';
// A driver that judges the stranded player not worth the trouble says this and leaves in peace.
export const SPARE_LINE = 'You are not worth the trouble.';

export const TOPICS: Record<TopicId, Topic> = {
  directions: {
    id: 'directions',
    once: false,
    ask: { text: 'Where is the nearest town?', when: ['knowsTown'], duringFeud: false },
    raise: null,
    prepare: 'nearestTown',
    hangUp: [],
    start: 'answer',
    nodes: {
      answer: {
        line: '{town} lies {bearing} of you, about {distance} out.',
        options: [
          { text: 'Thanks. Something else.', when: [], effects: ['revealTown'], go: HUB },
          { text: 'Thanks. Over and out.', when: [], effects: ['revealTown'], go: END },
        ],
      },
    },
  },
  // A driver that parked beside the stranded player and made its offer calls with the terms.
  tow: {
    id: 'tow',
    once: false,
    ask: null,
    raise: { when: ['offersPaidTow'], priority: 2, duringFeud: false, duringCombat: false },
    prepare: 'towOffer',
    hangUp: ['refuseTow'],
    start: 'offer',
    nodes: {
      offer: {
        line: 'I can pull you to {town}. {fee} when we get there.',
        options: [
          { text: 'Deal. Hitch me up.', when: [], effects: ['acceptTow'], go: END },
          { text: 'No thanks.', when: [], effects: ['refuseTow'], go: END },
        ],
      },
    },
  },
  // The same offer to a player with no money to pay.
  towFree: {
    id: 'towFree',
    once: false,
    ask: null,
    raise: { when: ['offersFreeTow'], priority: 2, duringFeud: false, duringCombat: false },
    prepare: 'towOffer',
    hangUp: ['refuseTow'],
    start: 'offer',
    nodes: {
      offer: {
        line: 'I can pull you to {town}. No charge.',
        options: [
          { text: 'Deal. Hitch me up.', when: [], effects: ['acceptTow'], go: END },
          { text: 'No thanks.', when: [], effects: ['refuseTow'], go: END },
        ],
      },
    },
  },
  // A stranded player asks a passing driver for help. It comes over and makes its offer by radio.
  askTow: {
    id: 'askTow',
    once: false,
    ask: { text: 'I am stranded. Can you tow me?', when: ['canTowPlayer', 'npcCalm'], duringFeud: false },
    raise: null,
    prepare: null,
    hangUp: [],
    start: 'coming',
    nodes: {
      coming: {
        line: 'Hold on. I am coming over.',
        options: [{ text: 'Thanks. I will wait.', when: [], effects: ['askTow'], go: END }],
      },
    },
  },
  // The stranded player asks for a patch. The driver looks, then names its terms or says it cannot help.
  patch: {
    id: 'patch',
    once: false,
    ask: { text: 'My truck is broken down. Can you patch it?', when: ['playerNeedsPatch', 'npcCalm', 'atPeace'], duringFeud: false },
    raise: null,
    prepare: 'patchTerms',
    hangUp: [],
    start: 'look',
    nodes: {
      look: {
        line: 'Let me hear what broke.',
        options: [
          { text: 'Engine, gearbox or tank. What would it take?', when: ['hasDeal'], effects: [], go: 'terms' },
          { text: 'Engine, gearbox or tank. Can you do anything?', when: ['noDeal'], effects: [], go: 'cannot' },
        ],
      },
      terms: {
        line: '{deal}',
        options: [
          { text: 'Deal. I will stay put.', when: [], effects: ['agreePatch'], go: END },
          { text: 'Not now. Something else.', when: [], effects: [], go: HUB },
        ],
      },
      cannot: {
        line: 'Not with what I have. Sorry.',
        options: [{ text: 'Understood.', when: [], effects: [], go: HUB }],
      },
    },
  },
  // A driver stranded by a broken engine, gearbox or tank asks the player once for a patch.
  patchRequest: {
    id: 'patchRequest',
    once: true,
    ask: null,
    raise: { when: ['npcNeedsPatch', 'npcOffRope', 'npcCalm', 'atPeace'], priority: 1, duringFeud: false, duringCombat: false },
    prepare: 'patchTerms',
    hangUp: ['settleRefused'],
    start: 'ask',
    nodes: {
      ask: {
        line: 'My truck is dead out here. Can you patch me up?',
        options: [
          { text: 'What are you offering?', when: ['hasDeal'], effects: [], go: 'terms' },
          { text: 'I cannot help, sorry.', when: ['noDeal'], effects: ['settleRefused'], go: END },
        ],
      },
      terms: {
        line: '{deal}',
        options: [
          { text: 'Deal. Stay where you are.', when: [], effects: ['agreePatch'], go: END },
          { text: 'Not today.', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
  // A raider or robber about to attack the player calls first, once, and asks for the cargo.
  demand: {
    id: 'demand',
    once: true,
    ask: null,
    raise: { when: ['demandsCargo'], priority: 3, duringFeud: true, duringCombat: true },
    prepare: null,
    hangUp: ['settleRefused'],
    start: 'demand',
    nodes: {
      demand: {
        line: 'Dump your cargo and roll on. Or we take it off your wreck.',
        options: [
          { text: 'Fine. Take it.', when: [], effects: ['handOver'], go: END },
          { text: 'Come and get it.', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
  // A robber that claimed cargo spilled from the player's broken cargo part calls once, even mid-fight. Leaving it
  // makes peace and keeps the rest of the cargo. Refusing or hanging up keeps the fight. It comes before the plain
  // claim warning, which it ties and precedes in PARLEY, since the robber is still hostile.
  spillClaim: {
    id: 'spillClaim',
    once: true,
    ask: null,
    raise: { when: ['claimsSpill'], priority: 4, duringFeud: true, duringCombat: true },
    prepare: null,
    hangUp: ['settleRefused'],
    start: 'claim',
    nodes: {
      claim: {
        line: "Your load's in the dirt. Roll on and it's ours, and we're square.",
        options: [
          { text: "It's yours.", when: [], effects: ['abandonSpill'], go: END },
          { text: 'Over my wreck.', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
  // A robber alone with the stranded player calls once. Giving up strips the truck of cargo and the best parts and
  // ends the fight. Refusing or hanging up makes the robber shoot at the cab.
  surrender: {
    id: 'surrender',
    once: true,
    ask: null,
    raise: { when: ['demandsSurrender'], priority: 5, duringFeud: true, duringCombat: true },
    prepare: null,
    hangUp: ['settleRefused'],
    start: 'offer',
    nodes: {
      offer: {
        line: 'Your truck is dead. Hand over the cargo and your best parts, and you keep the truck. Refuse, and I take it off your wreck.',
        options: [
          { text: 'Fine. Take it.', when: [], effects: ['surrender'], go: END },
          { text: 'Come and get it.', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
  // Any other driver alone with the stranded player, and a robber with nothing to take, calls once, unless it judged the
  // player not worth the trouble and left. See judgeStrandedFoe() in src/sim/parley.ts. Giving up ends the
  // fight with a truce and takes nothing. Refusing or hanging up makes every gun shoot at the cab.
  giveUp: {
    id: 'giveUp',
    once: true,
    ask: null,
    raise: { when: ['demandsGiveUp'], priority: 5, duringFeud: true, duringCombat: true },
    prepare: null,
    hangUp: ['settleRefused'],
    start: 'offer',
    nodes: {
      offer: {
        line: 'Your truck is dead in the road. Stand down and we both drive on.',
        options: [
          { text: 'Standing down.', when: [], effects: ['giveUp'], go: END },
          { text: 'Come and get it.', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
  // A driver that claimed a handed-over pile warns the parked player off it, once. Rolling on or hanging up puts the
  // player on the pile's backed-off list. Refusing starts a fight. See the pile claims in src/sim/parley.ts.
  claim: {
    id: 'claim',
    once: false,
    ask: null,
    raise: { when: ['guardsClaim'], priority: 4, duringFeud: false, duringCombat: false },
    prepare: null,
    hangUp: ['backOffClaim'],
    start: 'warn',
    nodes: {
      warn: {
        line: 'This is mine.',
        options: [
          { text: 'Rolling on.', when: [], effects: ['backOffClaim'], go: END },
          { text: 'Finders keepers.', when: [], effects: ['defyClaim'], go: END },
        ],
      },
    },
  },
  // Both trucks pull over side by side, and E opens the trade screen once both are parked. See src/sim/economy.ts.
  trade: {
    id: 'trade',
    once: false,
    ask: { text: 'Want to trade?', when: ['noTrade', 'npcCalm'], duringFeud: false },
    raise: null,
    prepare: null,
    hangUp: [],
    start: 'offer',
    nodes: {
      offer: {
        line: 'Sure. Pull over and I will come alongside.',
        options: [
          { text: 'Pulling over.', when: [], effects: ['startTrade'], go: END },
          { text: 'Never mind.', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
  // The player asks a foe for a truce. The driver's answer is rolled when the topic opens. A robber holding up the
  // player answers with its cargo demand instead. The player asks the same
  // driver again only after the plea state runs out.
  truce: {
    id: 'truce',
    once: false,
    ask: { text: 'Enough shooting. Can we call a truce?', when: ['atOdds', 'noPlayerPlea'], duringFeud: true },
    raise: null,
    prepare: 'truceAnswer',
    hangUp: ['withdrawPlea'],
    start: 'listen',
    nodes: {
      listen: {
        line: 'I am listening.',
        options: [
          { text: 'We both drive away.', when: ['accepts'], effects: ['settlePlea'], go: 'agreed' },
          { text: 'We both drive away.', when: ['refuses'], effects: ['settlePlea'], go: 'refused' },
          { text: 'We both drive away.', when: ['demandsToll'], effects: [], go: 'demanded' },
        ],
      },
      // A robber after the player's cargo names its price instead of granting a free truce.
      demanded: {
        line: 'No free ride. Dump your cargo and roll on, and we call it square.',
        options: [
          { text: 'Fine. Take it.', when: [], effects: ['payToll'], go: END },
          { text: 'Come and get it.', when: [], effects: ['refuseToll'], go: END },
        ],
      },
      agreed: { line: 'Fine. Keep your guns down.', options: [{ text: 'Over and out.', when: [], effects: [], go: END }] },
      refused: { line: 'Too late for talk.', options: [{ text: 'Then we finish this.', when: [], effects: [], go: END }] },
    },
  },
  // The player gives up to a foe. A driver that spares the player gets the player's cargo and holds a truce.
  mercy: {
    id: 'mercy',
    once: false,
    ask: { text: 'I give up. Let me go.', when: ['atOdds', 'noPlayerPlea'], duringFeud: true },
    raise: null,
    prepare: 'mercyAnswer',
    hangUp: ['withdrawPlea'],
    start: 'listen',
    nodes: {
      listen: {
        line: 'Talk fast.',
        options: [
          { text: 'Take what I carry. Just let me drive away.', when: ['accepts'], effects: ['settlePlea'], go: 'spared' },
          { text: 'Take what I carry. Just let me drive away.', when: ['refuses'], effects: ['settlePlea'], go: 'refused' },
        ],
      },
      spared: { line: 'Leave it on the ground and go.', options: [{ text: 'Going.', when: [], effects: [], go: END }] },
      refused: { line: 'No deals.', options: [{ text: 'Then come and get me.', when: [], effects: [], go: END }] },
    },
  },
  // The player demands a badly broken foe give up. The driver answers once while it keeps the player in sight, like
  // a stranded NPC offered a way out. One that agrees gives up where it stands, and the player strips its truck like a
  // knocked-out one.
  yieldDemand: {
    id: 'yieldDemand',
    once: false,
    ask: { text: 'Your truck is finished. Stand down and let me strip it, and you live.', when: ['atOdds', 'npcBeaten', 'notOfferedYield'], duringFeud: true },
    raise: null,
    prepare: 'yieldAnswer',
    hangUp: [],
    start: 'hear',
    nodes: {
      hear: {
        line: 'You want to pick my truck clean?',
        options: [
          { text: 'Your call. Last chance.', when: ['accepts'], effects: [], go: 'agreed' },
          { text: 'Your call. Last chance.', when: ['refuses'], effects: [], go: 'refused' },
        ],
      },
      agreed: { line: 'All right. I am done. Take what you want.', options: [{ text: 'Sit tight.', when: [], effects: ['yieldToPlayer'], go: END }] },
      refused: { line: 'Not while I can still pull a trigger.', options: [{ text: 'Then we finish this.', when: [], effects: ['settleRefused'], go: END }] },
    },
  },
  // The player demands the cargo of a driver at peace, once. It gives the cargo up, fights or runs.
  rob: {
    id: 'rob',
    once: true,
    ask: { text: 'Drop your cargo, or we open fire.', when: ['atPeace', 'npcHasCargo'], duringFeud: false },
    raise: null,
    prepare: 'threatAnswer',
    hangUp: ['settleRefused'],
    start: 'hear',
    nodes: {
      hear: {
        line: 'Say that again?',
        options: [
          { text: 'You heard me. Cargo on the ground, now.', when: ['complies'], effects: ['settleThreat'], go: 'comply' },
          { text: 'You heard me. Cargo on the ground, now.', when: ['resists'], effects: ['settleThreat'], go: 'fightBack' },
          { text: 'You heard me. Cargo on the ground, now.', when: ['runs'], effects: ['settleThreat'], go: 'flee' },
        ],
      },
      comply: { line: 'All right! It is on the ground. Now leave us alone.', options: [{ text: 'Smart choice.', when: [], effects: [], go: END }] },
      fightBack: { line: 'Come and take it.', options: [{ text: 'Your funeral.', when: [], effects: [], go: END }] },
      flee: { line: 'Not today!', options: [{ text: 'Run, then.', when: [], effects: [], go: END }] },
    },
  },
  // The player tells a driver at peace that loots the player's wreck to back off, once. It backs off, keeps looting
  // or fights.
  warnOff: {
    id: 'warnOff',
    once: true,
    ask: { text: 'This wreck is mine. Back off.', when: ['atPeace', 'claimsPlayerLoot'], duringFeud: false },
    raise: null,
    prepare: 'warnAnswer',
    hangUp: ['settleRefused'],
    start: 'hear',
    nodes: {
      hear: {
        line: 'Says who?',
        options: [
          { text: 'You heard me. Leave it.', when: ['complies'], effects: ['settleWarning'], go: 'comply' },
          { text: 'You heard me. Leave it.', when: ['holdsOn'], effects: ['settleWarning'], go: 'refuse' },
          { text: 'You heard me. Leave it.', when: ['resists'], effects: ['settleWarning'], go: 'fightBack' },
        ],
      },
      comply: { line: "Fine. It's yours.", options: [{ text: 'Good.', when: [], effects: [], go: END }] },
      refuse: { line: 'Find your own wreck.', options: [{ text: 'We will see.', when: [], effects: [], go: END }] },
      fightBack: { line: 'Over my dead body.', options: [{ text: 'Have it your way.', when: [], effects: [], go: END }] },
    },
  },
  // A foe hurt in a fight with the player asks for a truce.
  truceOffer: {
    id: 'truceOffer',
    once: false,
    ask: null,
    raise: { when: ['offersTruce'], priority: 4, duringFeud: true, duringCombat: true },
    prepare: null,
    hangUp: ['refusePlea'],
    start: 'offer',
    nodes: {
      offer: {
        line: 'Enough of this. We both drive away.',
        options: [
          { text: 'Agreed. Guns down.', when: [], effects: ['acceptPlea'], go: END },
          { text: 'No. We finish this.', when: [], effects: ['refusePlea'], go: END },
        ],
      },
    },
  },
  // A beaten foe gives up. Sparing it leaves its cargo on the ground for the player. The player can instead demand that
  // it stand down and be stripped, which it answers like the yieldDemand topic.
  mercyPlea: {
    id: 'mercyPlea',
    once: false,
    ask: null,
    raise: { when: ['begsMercy'], priority: 4, duringFeud: true, duringCombat: true },
    prepare: null,
    hangUp: ['refusePlea'],
    start: 'beg',
    nodes: {
      beg: {
        line: 'Stop shooting! I give up. Take what I carry and let me go.',
        options: [
          { text: 'Dump your cargo and drive off.', when: [], effects: ['acceptPlea'], go: END },
          { text: 'Stand down and let me strip your truck.', when: ['notOfferedYield'], effects: ['askStandDown'], go: 'strip' },
          { text: 'No mercy.', when: [], effects: ['refusePlea'], go: END },
        ],
      },
      strip: {
        line: 'You want to pick my truck clean?',
        options: [
          { text: 'Your call. Last chance.', when: ['accepts'], effects: [], go: 'stripAgreed' },
          { text: 'Your call. Last chance.', when: ['refuses'], effects: [], go: 'stripRefused' },
        ],
      },
      stripAgreed: {
        line: 'All right. I am done. Take what you want.',
        options: [{ text: 'Sit tight.', when: [], effects: ['standDownPlea'], go: END }],
      },
      stripRefused: {
        line: 'Not while I can still pull a trigger.',
        options: [{ text: 'Then we finish this.', when: [], effects: ['refusePlea'], go: END }],
      },
    },
  },
  // The player offers a stranded driver a tow to the town or camp it names, for what it can pay or for free.
  offerTow: {
    id: 'offerTow',
    once: false,
    ask: { text: 'Need a tow to town?', when: ['canTowNpc'], duringFeud: false },
    raise: null,
    prepare: 'npcTowTerms',
    hangUp: [],
    start: 'terms',
    nodes: {
      terms: {
        line: 'Take me to {site}. I can pay {fee} when we get there.',
        options: [
          { text: 'Deal. Hitch up.', when: [], effects: ['hitchNpc'], go: END },
          { text: 'No charge. Hitch up.', when: [], effects: ['hitchNpcFree'], go: END },
          { text: 'Not now. Something else.', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
  // The player lets a towed driver off the rope for free.
  releaseTow: {
    id: 'releaseTow',
    once: false,
    ask: { text: 'I am letting you off the rope here.', when: ['towedByPlayer'], duringFeud: false },
    raise: null,
    prepare: null,
    hangUp: ['releaseNpc'],
    start: 'released',
    nodes: {
      released: { line: 'Fine. Thanks for the pull.', options: [{ text: 'Over and out.', when: [], effects: ['releaseNpc'], go: END }] },
    },
  },
  // The player offers to patch a driver stranded by a broken engine, gearbox or tank.
  offerPatch: {
    id: 'offerPatch',
    once: false,
    ask: { text: 'Your truck looks dead. Want me to patch it?', when: ['npcNeedsPatch', 'npcOffRope', 'atPeace'], duringFeud: false },
    raise: null,
    prepare: 'patchTerms',
    hangUp: [],
    start: 'ask',
    nodes: {
      ask: {
        line: 'You know how? Then name it.',
        options: [
          { text: 'What can you offer?', when: ['hasDeal'], effects: [], go: 'terms' },
          { text: 'On second thought, I cannot.', when: ['noDeal'], effects: [], go: HUB },
        ],
      },
      terms: {
        line: '{deal}',
        options: [
          { text: 'Deal. Stay where you are.', when: [], effects: ['agreePatch'], go: END },
          { text: 'Not now. Something else.', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
  // The player offers to patch a driver whose engine, gearbox or tank is worn thin, before it strands.
  offerPatchWorn: {
    id: 'offerPatchWorn',
    once: false,
    ask: { text: 'Your engine sounds rough. Want me to patch it before it quits?', when: ['npcWorn', 'npcOffRope', 'npcCalm', 'atPeace'], duringFeud: false },
    raise: null,
    prepare: 'patchTerms',
    hangUp: [],
    start: 'ask',
    nodes: {
      ask: {
        line: 'You know how? Then name it.',
        options: [
          { text: 'What can you offer?', when: ['hasDeal'], effects: [], go: 'terms' },
          { text: 'On second thought, I cannot.', when: ['noDeal'], effects: [], go: HUB },
        ],
      },
      terms: {
        line: '{deal}',
        options: [
          { text: 'Deal. Pull over and wait.', when: [], effects: ['agreePatch'], go: END },
          { text: 'Not now. Something else.', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
  // A driver back from a town tells its prices. Needs the Market ears perk.
  marketNews: {
    id: 'marketNews',
    once: false,
    ask: { text: 'How are prices in town?', when: ['knowsLastTown'], duringFeud: false },
    raise: null,
    prepare: 'lastTownPrices',
    hangUp: [],
    start: 'prices',
    nodes: {
      prices: {
        line: 'Last I was in {town}: {prices}.',
        options: [
          { text: 'Thanks. Something else.', when: [], effects: [], go: HUB },
          { text: 'Thanks. Over and out.', when: [], effects: [], go: END },
        ],
      },
    },
  },
  // A driver tells of an undiscovered site or a wreck with loot near its route, once. Needs the Rumor mill perk.
  rumor: {
    id: 'rumor',
    once: true,
    ask: { text: 'Seen anything worth a look out there?', when: ['hearsRumor'], duringFeud: false },
    raise: null,
    prepare: 'nearestRumor',
    hangUp: [],
    start: 'tell',
    nodes: {
      tell: {
        line: 'Maybe. I passed something on my way.',
        options: [
          { text: 'Where?', when: ['rumorOfSite'], effects: [], go: 'site' },
          { text: 'Where?', when: ['rumorOfWreck'], effects: [], go: 'wreck' },
        ],
      },
      site: {
        line: '{site} lies {bearing} of you, about {distance} out.',
        options: [
          { text: 'Thanks. Something else.', when: [], effects: ['revealRumor', 'settleDone'], go: HUB },
          { text: 'Thanks. Over and out.', when: [], effects: ['revealRumor', 'settleDone'], go: END },
        ],
      },
      wreck: {
        line: 'A wreck nobody picked clean, {bearing} of you, about {distance} out.',
        options: [
          { text: 'Thanks. Something else.', when: [], effects: ['revealRumor', 'settleDone'], go: HUB },
          { text: 'Thanks. Over and out.', when: [], effects: ['revealRumor', 'settleDone'], go: END },
        ],
      },
    },
  },
  // A driver near the lost Army wagon tells where it saw it, once the player has heard of it at Bowl. It needs no
  // perk and marks nothing: the journal keeps the driver's words. See src/data/locals.ts.
  armyWagon: {
    id: 'armyWagon',
    once: true,
    ask: { text: 'Seen a dead Army wagon out here?', when: ['heardWagonNearby'], duringFeud: false },
    raise: null,
    prepare: null,
    hangUp: [],
    start: 'tell',
    nodes: {
      tell: {
        line: 'Army wagon? Yeah, I passed one. It lies in a hollow, closer to the Bowl north road than to the Pump Station track, south of an old farm with a water tower. Nobody was at it that I saw.',
        options: [
          { text: 'Thanks. Something else.', when: [], effects: ['noteWagonRoad', 'settleDone'], go: HUB },
          { text: 'Thanks. Over and out.', when: [], effects: ['noteWagonRoad', 'settleDone'], go: END },
        ],
      },
    },
  },
  // A driver tells one trading tip from the prices it remembers, or that it has none.
  tips: {
    id: 'tips',
    once: false,
    ask: { text: 'Anything interesting?', when: [], duringFeud: false },
    raise: null,
    prepare: 'tradeTip',
    hangUp: [],
    start: 'tell',
    nodes: {
      tell: {
        line: '{tip}',
        options: [
          { text: 'Thanks. Something else.', when: [], effects: [], go: HUB },
          { text: 'Over and out.', when: [], effects: [], go: END },
        ],
      },
    },
  },
  // The player buys peace from a foe for a share of its truck value. No roll. Needs the Paid truce perk.
  buyTruce: {
    id: 'buyTruce',
    once: false,
    ask: { text: 'What would it cost to call this off?', when: ['atOdds', 'canPayTruce'], duringFeud: true },
    raise: null,
    prepare: 'trucePrice',
    hangUp: [],
    start: 'price',
    nodes: {
      price: {
        line: '{price}, and we forget it.',
        options: [
          { text: 'Deal. Sending it.', when: [], effects: ['payTruce'], go: 'paid' },
          { text: 'Too much.', when: [], effects: [], go: HUB },
        ],
      },
      paid: { line: 'Money is in. Guns down.', options: [{ text: 'Over and out.', when: [], effects: [], go: END }] },
    },
  },
  // The player offers a driver low on fuel or supplies some of its own, for what the driver can pay or for free. The
  // two trucks meet side by side before anything moves. See src/sim/aid.ts.
  offerAid: {
    id: 'offerAid',
    once: false,
    ask: { text: 'Running low? I can spare some.', when: ['noAid', 'atPeace', 'npcCalm', 'npcLow', 'npcOffRope'], duringFeud: false },
    raise: null,
    prepare: 'aidWanted',
    hangUp: [],
    start: 'terms',
    nodes: {
      terms: {
        line: 'I could use {aid}. I can pay {price}.',
        options: [
          { text: 'Deal.', when: [], effects: ['giveAidPaid'], go: END },
          { text: 'No charge.', when: [], effects: ['giveAidFree'], go: END },
          { text: 'Not now. Something else.', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
  // A player low on fuel or supplies asks a driver for a little, once. The answer is rolled when the topic opens.
  askAid: {
    id: 'askAid',
    once: true,
    ask: { text: 'I am running dry. Can you spare some?', when: ['noAid', 'atPeace', 'npcCalm', 'playerLow'], duringFeud: false },
    raise: null,
    prepare: 'aidAnswer',
    hangUp: ['settleRefused'],
    start: 'check',
    nodes: {
      check: {
        line: 'Let me check my tanks.',
        options: [
          { text: 'Whatever you can spare.', when: ['aidGiven'], effects: [], go: 'give' },
          { text: 'Whatever you can spare.', when: ['aidRefused'], effects: ['settleRefused'], go: 'refuse' },
        ],
      },
      give: {
        line: 'I can spare {aid}. Stay put, I am coming.',
        options: [{ text: 'Thanks. I will wait.', when: [], effects: ['takeAid', 'settleDone'], go: END }],
      },
      refuse: { line: 'Sorry. Cannot spare any.', options: [{ text: 'Understood.', when: [], effects: [], go: HUB }] },
    },
  },
  // A driver that saw a poor player low on fuel or supplies offers some, free. Not answering lets the offer expire.
  aidOffer: {
    id: 'aidOffer',
    once: false,
    ask: null,
    raise: { when: ['offersAid'], priority: 1, duringFeud: false, duringCombat: false },
    prepare: 'aidOffered',
    hangUp: ['refuseAidOffer'],
    start: 'offer',
    nodes: {
      offer: {
        line: 'You look dry. I can spare {aid}, no charge.',
        options: [
          { text: 'Thanks. I will wait.', when: [], effects: ['acceptAidOffer'], go: END },
          { text: 'No thanks.', when: [], effects: ['refuseAidOffer'], go: END },
        ],
      },
    },
  },
};

// A trading tip in words. {site} is the shop's site, {good} the good's name and {was} its verb, "was" or "were".
// The tip never names a number.
export const TIP_LINES = {
  dear: 'Last time I was at {site}, {good} {was} very overpriced.',
  cheap: 'Last time I was at {site}, {good} {was} going cheap.',
  none: 'Nothing worth telling.',
};

// Patch terms in the NPC's words. `npcPatches` when the NPC does the work, `playerPatches` when it asks the player
// to. Filled with {price}, and with {parts} as a count with its unit, like "2 parts". Lines never name turns.
export const DEAL_LINES: Record<PatchDeal, { npcPatches: string; playerPatches: string }> = {
  paid: {
    npcPatches: 'I have the parts. {parts} and the work, {price} all in.',
    playerPatches: 'I pay {price} if you use {parts} of yours.',
  },
  ownParts: {
    npcPatches: 'It takes {parts} of yours. I charge {price} for the work.',
    playerPatches: 'I have {parts} here. {price} for your work.',
  },
  free: {
    npcPatches: 'I will do it for nothing. {parts} of mine.',
    playerPatches: 'I cannot pay. Could you spare {parts}?',
  },
};

// How a driver talks. The first of its traits with a voice speaks for it.
export type Voice = {
  greeting: string; // the hub line when the player calls
  repeatLine: string; // the answer to a `once` topic already settled
  refusal: string; // the answer when a driver in a feud has no topic to take up
  honksBack: boolean; // answers the player's honk when not hostile
};

// What each trait adds to talk. A driver can take up the union of its traits' topics. Only talkOf() in
// src/sim/dialogue.ts reads this.
export type TraitTalk = { voice: Voice | null; topics: TopicId[] };

// Tiles a horn carries. It is about as loud as an engine at limp speed, so it reaches a little past sight.
export const HONK_RANGE = DETECT.sound.limp;

// Every driver can be asked for peace, robbed, warned off a wreck, towed, patched and given fuel or supplies, and can
// plead for peace.
const PARLEY: TopicId[] = ['spillClaim', 'surrender', 'giveUp', 'claim', 'truce', 'mercy', 'yieldDemand', 'buyTruce', 'rob', 'warnOff', 'truceOffer', 'mercyPlea', 'offerTow', 'releaseTow', 'offerPatch', 'offerPatchWorn', 'offerAid'];

export const TRAIT_TALK: Record<TraitId, TraitTalk> = {
  trader: { voice: { greeting: 'Go ahead.', repeatLine: 'We already talked about that.', refusal: 'Nothing to say to you.', honksBack: true }, topics: ['directions', 'marketNews', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', 'patch', 'patchRequest', 'trade', ...PARLEY] },
  scavenger: { voice: { greeting: 'Yeah? Make it quick.', repeatLine: 'I told you already.', refusal: 'Get off my channel.', honksBack: true }, topics: ['directions', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', 'patch', 'patchRequest', 'trade', ...PARLEY] },
  raider: { voice: { greeting: 'Get lost.', repeatLine: 'Get lost.', refusal: 'Heh. No.', honksBack: false }, topics: ['demand', ...PARLEY] },
  scumbag: { voice: null, topics: ['demand', ...PARLEY] },
  coward: { voice: null, topics: PARLEY },
  brave: { voice: null, topics: PARLEY },
  lawman: { voice: { greeting: 'Speak up.', repeatLine: 'Heard you the first time.', refusal: 'Clear the channel.', honksBack: true }, topics: ['directions', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', ...PARLEY] },
  courier: { voice: { greeting: 'Make it short.', repeatLine: 'Said that already.', refusal: 'No time. Out.', honksBack: true }, topics: ['directions', 'marketNews', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', 'trade', ...PARLEY] },
  roamer: { voice: { greeting: 'What do you want?', repeatLine: 'Old news, friend.', refusal: 'Not talking.', honksBack: true }, topics: ['directions', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', 'patch', 'patchRequest', 'trade', ...PARLEY] },
  vulture: { voice: { greeting: 'Keep it short.', repeatLine: 'Already said.', refusal: 'Nothing for you.', honksBack: false }, topics: ['directions', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'patchRequest', 'trade', ...PARLEY] },
  supplier: { voice: { greeting: 'Listening.', repeatLine: 'We covered that.', refusal: 'Keep off this channel.', honksBack: true }, topics: ['directions', 'marketNews', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', 'trade', ...PARLEY] },
  guard: { voice: { greeting: 'State your business.', repeatLine: 'Heard you.', refusal: 'Move along.', honksBack: false }, topics: ['directions', ...PARLEY] },
  merc: { voice: { greeting: 'Talk.', repeatLine: 'You said that.', refusal: 'Not interested.', honksBack: false }, topics: ['directions', ...PARLEY] },
};
