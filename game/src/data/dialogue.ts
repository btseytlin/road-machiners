// Dialogue content: topics the player and NPCs talk about over the radio. A topic holds line ids and structure
// only. Its logic lives in the named conditions, effects and prepare steps of src/sim/dialogue-rules.ts.
// Lines are ids. Their words live in src/text/, where `{name}` is filled from the call values the topic's prepare step made.

import { DETECT } from './detect';
import type { TraitId } from './npcs';

export type TopicId = 'directions' | 'tow' | 'towFree' | 'askTow' | 'patch' | 'patchRequest' | 'demand' | 'surrender' | 'giveUp' | 'claim' | 'trade' | 'truce' | 'mercy' | 'rob' | 'warnOff' | 'truceOffer' | 'mercyPlea' | 'offerTow' | 'releaseTow' | 'offerPatch' | 'offerPatchWorn' | 'marketNews' | 'rumor' | 'tips' | 'buyTruce' | 'offerAid' | 'askAid' | 'aidOffer' | 'yieldDemand' | 'spillClaim' | 'lootWarning' | 'armyWagon';
export type ConditionId =
  | 'knowsTown' | 'offersPaidTow' | 'offersFreeTow' | 'canTowPlayer' | 'playerNeedsPatch' | 'npcNeedsPatch' | 'npcWorn' | 'npcOffRope' | 'hasDeal' | 'noDeal' | 'demandsCargo' | 'demandsSurrender' | 'demandsGiveUp' | 'guardsClaim'
  | 'atOdds' | 'atPeace' | 'noPlayerPlea' | 'demandsToll' | 'npcHasCargo' | 'offersTruce' | 'begsMercy'
  | 'accepts' | 'refuses' | 'complies' | 'resists' | 'runs' | 'claimsPlayerLoot' | 'holdsOn' | 'canTowNpc' | 'towedByPlayer' | 'noTrade' | 'npcCalm'
  | 'knowsLastTown' | 'hearsRumor' | 'rumorOfSite' | 'rumorOfWreck' | 'canPayTruce'
  | 'npcLow' | 'playerLow' | 'noAid' | 'aidGiven' | 'aidRefused' | 'offersAid' | 'npcBeaten' | 'notOfferedYield' | 'claimsSpill' | 'heardWagonNearby'
  | 'warnsPlayerOff' | 'yieldsLoot' | 'fightsForLoot';
export type EffectId =
  | 'revealTown' | 'settleDone' | 'settleRefused' | 'acceptTow' | 'refuseTow' | 'askTow' | 'agreePatch' | 'handOver' | 'surrender' | 'giveUp' | 'backOffClaim' | 'defyClaim'
  | 'acceptPlea' | 'refusePlea' | 'settlePlea' | 'payToll' | 'refuseToll' | 'withdrawPlea' | 'settleThreat' | 'settleWarning' | 'hitchNpc' | 'hitchNpcFree' | 'releaseNpc' | 'startTrade'
  | 'revealRumor' | 'payTruce' | 'giveAidPaid' | 'giveAidFree' | 'takeAid' | 'acceptAidOffer' | 'refuseAidOffer' | 'yieldToPlayer' | 'askStandDown' | 'standDownPlea' | 'abandonSpill' | 'noteWagonRoad'
  | 'leaveLootWarning' | 'refuseLootWarning' | 'fightLootWarning' | 'hangUpLootWarning';
export type PrepareId = 'nearestTown' | 'towOffer' | 'patchTerms' | 'truceAnswer' | 'mercyAnswer' | 'threatAnswer' | 'warnAnswer' | 'npcTowTerms' | 'lastTownPrices' | 'nearestRumor' | 'tradeTip' | 'trucePrice' | 'aidWanted' | 'aidAnswer' | 'aidOffered' | 'yieldAnswer' | 'lootWarningTerms';

// `go` is a node of the same topic, the hub of topics, or the end of the call.
export type DialogueOption = { say: LineId; when: ConditionId[]; effects: EffectId[]; go: string };
export type DialogueNode = { line: LineId; options: DialogueOption[] };

export type Topic = {
  id: TopicId;
  once: boolean; // a driver raises or answers it with the player at most once
  // How the player raises it from the hub. A driver in a feud with the player takes up only topics asked during
  // feuds.
  ask: { say: LineId; when: ConditionId[]; duringFeud: boolean } | null;
  // When an NPC calls the player with it; higher priority wins. A feud stops the call unless `duringFeud`. A player
  // in combat takes only calls that are part of the fight, marked `duringCombat`.
  raise: { when: ConditionId[]; priority: number; duringFeud: boolean; duringCombat: boolean } | null;
  prepare: PrepareId | null;
  hangUp: EffectId[];
  start: string;
  nodes: Record<string, DialogueNode>;
};

// Every line said over the radio, by the NPC or the player, by id. src/text/ holds their words. A call keeps the id of
// the line said last, so an id stays once a save holds it.
export const LINE_IDS = [
  'aWreckNobodyPicked', 'armyWagonTold', 'seenADeadArmy', 'whatElseDidYouSee', 'agreedGunsDown', 'allRightIAm', 'allRightItIs', 'alreadySaid', 'anythingInteresting',
  'busy', 'canYouDoAnything', 'clearTheChannel', 'comeAndGetIt', 'comeAndTakeIt', 'dealHitchMeUp', 'dealHitchUp',
  'dealIWillStay', 'dealPlain', 'dealPullOverAnd', 'dealSendingIt', 'dealStayWhereYou', 'dealTerms', 'demandCargo',
  'dropYourCargoOr', 'dumpAndDrive', 'enoughOfThisWe', 'enoughShootingCanWe', 'findYourOwnWreck', 'findersKeepers',
  'fineItsYours', 'fineKeepYourGuns', 'fineTakeIt', 'fineThanksForThe', 'getLost', 'getOffMyChannel', 'giveUpOffer',
  'goAhead', 'going', 'good', 'hangUp', 'haveItYourWay', 'heardYou', 'heardYouTheFirst', 'hehNo', 'holdOnIAm',
  'howArePricesIn', 'iAmLettingYou', 'iAmListening', 'iAmRunningDry', 'iAmStrandedCan', 'iCanSpareAid',
  'iCannotHelpSorry', 'iCouldUseAid', 'iGiveUpLet', 'iToldYouAlready', 'itIsYours', 'keepItShort', 'keepOffThisChannel',
  'lastIWasIn', 'leaveItOnThe', 'letMeCheckMy', 'letMeHearWhat', 'listening', 'makeItShort', 'maybeIPassedSomething',
  'moneyIsInGuns', 'moveAlong', 'myTruckIsBroken', 'myTruckIsDead', 'needATowTo', 'neverMind', 'noCharge',
  'noChargeHitchUp', 'noDeals', 'noFreeRideDump', 'noMercy', 'noThanks', 'noTimeOut', 'noWeFinishThis',
  'notInterested', 'notNowSomethingElse', 'notTalking', 'notToday', 'notTodayRun', 'notWhileICan', 'notWithWhatI',
  'nothingForYou', 'nothingToSayTo', 'oldNewsFriend', 'onSecondThoughtI', 'overAndOut', 'overMyDeadBody', 'overMyWreck', 'pullFree',
  'pullPaid', 'pullingOver', 'rollingOn', 'runThen', 'runningLowICan', 'saidThatAlready', 'sayThatAgain', 'saysWho',
  'seenAnythingWorthA', 'sitTight', 'siteBearing', 'smartChoice', 'sorryCannotSpareAny', 'spare', 'speakUp',
  'standDownAndLet', 'standingDown', 'stateYourBusiness', 'stopShootingIGive', 'surePullOverAnd', 'surrenderOffer',
  'takeMeToSite', 'takeWhatICarry', 'talk', 'talkFast', 'thanksIWillWait', 'thanksOverAndOut', 'thanksSomethingElse',
  'thenComeAndGet', 'thenWeFinishThis', 'thisIsMine', 'thisWreckIsMine', 'tipTold', 'tooLateForTalk', 'tooMuch',
  'townBearing', 'truceCost', 'understood', 'wantToTrade', 'weAlreadyTalkedAbout', 'weBothDriveAway',
  'weCoveredThat', 'weWillSee', 'whatAreYouOffering', 'whatCanYouOffer', 'whatDoYouWant', 'whatWouldItCost',
  'whatWouldItTake', 'whateverYouCanSpare', 'where', 'whereIsTheNearest', 'yeahMakeItQuick', 'youHeardMeCargo',
  'youHeardMeLeave', 'youKnowHowThen', 'youLookDryI', 'youSaidThat', 'youWantToPick', 'yourCallLastChance',
  'yourEngineSoundsRough', 'yourFuneral', 'yourLoadIsInThe', 'yourTruckIsFinished', 'yourTruckLooksDead',
  'warnTerms', 'thisOneIsSpokenFor', 'thatsMyPick', 'offMyLootNow', 'leaveThatSalvageBe', 'imTakingThatOne', 'sawThisOneFirst', 'mineGoPickAnother', 'weAreTakingThisOne', 'backAwayFromThat', 'thatsMineWalkAway', 'findYourOwn', 'makeMe', 'keepYourScrapsThen', 'thoughtSo', 'thenWeSettleIt', 'bringIt',
] as const;
export type LineId = (typeof LINE_IDS)[number];

export const HUB = 'hub';
export const END = 'end';
export const REFUSED = 'callRefused';
// What a driver busy fighting another truck says when the player calls.
export const BUSY_LINE: LineId = 'busy';
// A driver that judges the stranded player not worth the trouble says this and leaves in peace.
export const SPARE_LINE: LineId = 'spare';
// The player's last option, which ends the call.
export const HANG_UP_LINE: LineId = 'hangUp';
export const QUEST_GO = 'quest:';

export function questGo(quest: string): string {
  return `${QUEST_GO}${quest}`;
}

export function handoffQuest(go: string): string | null {
  return go.startsWith(QUEST_GO) ? go.slice(QUEST_GO.length) : null;
}

export const TOPICS: Record<TopicId, Topic> = {
  directions: {
    id: 'directions',
    once: false,
    ask: { say: 'whereIsTheNearest', when: ['knowsTown'], duringFeud: false },
    raise: null,
    prepare: 'nearestTown',
    hangUp: [],
    start: 'answer',
    nodes: {
      answer: {
        line: 'townBearing',
        options: [
          { say: 'thanksSomethingElse', when: [], effects: ['revealTown'], go: HUB },
          { say: 'thanksOverAndOut', when: [], effects: ['revealTown'], go: END },
        ],
      },
    },
  },
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
        line: 'pullPaid',
        options: [
          { say: 'dealHitchMeUp', when: [], effects: ['acceptTow'], go: END },
          { say: 'noThanks', when: [], effects: ['refuseTow'], go: END },
        ],
      },
    },
  },
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
        line: 'pullFree',
        options: [
          { say: 'dealHitchMeUp', when: [], effects: ['acceptTow'], go: END },
          { say: 'noThanks', when: [], effects: ['refuseTow'], go: END },
        ],
      },
    },
  },
  askTow: {
    id: 'askTow',
    once: false,
    ask: { say: 'iAmStrandedCan', when: ['canTowPlayer', 'npcCalm'], duringFeud: false },
    raise: null,
    prepare: null,
    hangUp: [],
    start: 'coming',
    nodes: {
      coming: {
        line: 'holdOnIAm',
        options: [{ say: 'thanksIWillWait', when: [], effects: ['askTow'], go: END }],
      },
    },
  },
  patch: {
    id: 'patch',
    once: false,
    ask: { say: 'myTruckIsBroken', when: ['playerNeedsPatch', 'npcCalm', 'atPeace'], duringFeud: false },
    raise: null,
    prepare: 'patchTerms',
    hangUp: [],
    start: 'look',
    nodes: {
      look: {
        line: 'letMeHearWhat',
        options: [
          { say: 'whatWouldItTake', when: ['hasDeal'], effects: [], go: 'terms' },
          { say: 'canYouDoAnything', when: ['noDeal'], effects: [], go: 'cannot' },
        ],
      },
      terms: {
        line: 'dealTerms',
        options: [
          { say: 'dealIWillStay', when: [], effects: ['agreePatch'], go: END },
          { say: 'notNowSomethingElse', when: [], effects: [], go: HUB },
        ],
      },
      cannot: {
        line: 'notWithWhatI',
        options: [{ say: 'understood', when: [], effects: [], go: HUB }],
      },
    },
  },
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
        line: 'myTruckIsDead',
        options: [
          { say: 'whatAreYouOffering', when: ['hasDeal'], effects: [], go: 'terms' },
          { say: 'iCannotHelpSorry', when: ['noDeal'], effects: ['settleRefused'], go: END },
        ],
      },
      terms: {
        line: 'dealTerms',
        options: [
          { say: 'dealStayWhereYou', when: [], effects: ['agreePatch'], go: END },
          { say: 'notToday', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
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
        line: 'demandCargo',
        options: [
          { say: 'fineTakeIt', when: [], effects: ['handOver'], go: END },
          { say: 'comeAndGetIt', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
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
        line: 'yourLoadIsInThe',
        options: [
          { say: 'itIsYours', when: [], effects: ['abandonSpill'], go: END },
          { say: 'overMyWreck', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
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
        line: 'surrenderOffer',
        options: [
          { say: 'fineTakeIt', when: [], effects: ['surrender'], go: END },
          { say: 'comeAndGetIt', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
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
        line: 'giveUpOffer',
        options: [
          { say: 'standingDown', when: [], effects: ['giveUp'], go: END },
          { say: 'comeAndGetIt', when: [], effects: ['settleRefused'], go: END },
        ],
      },
    },
  },
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
        line: 'thisIsMine',
        options: [
          { say: 'rollingOn', when: [], effects: ['backOffClaim'], go: END },
          { say: 'findersKeepers', when: [], effects: ['defyClaim'], go: END },
        ],
      },
    },
  },
  trade: {
    id: 'trade',
    once: false,
    ask: { say: 'wantToTrade', when: ['noTrade', 'npcCalm'], duringFeud: false },
    raise: null,
    prepare: null,
    hangUp: [],
    start: 'offer',
    nodes: {
      offer: {
        line: 'surePullOverAnd',
        options: [
          { say: 'pullingOver', when: [], effects: ['startTrade'], go: END },
          { say: 'neverMind', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
  truce: {
    id: 'truce',
    once: false,
    ask: { say: 'enoughShootingCanWe', when: ['atOdds', 'noPlayerPlea'], duringFeud: true },
    raise: null,
    prepare: 'truceAnswer',
    hangUp: ['withdrawPlea'],
    start: 'listen',
    nodes: {
      listen: {
        line: 'iAmListening',
        options: [
          { say: 'weBothDriveAway', when: ['accepts'], effects: ['settlePlea'], go: 'agreed' },
          { say: 'weBothDriveAway', when: ['refuses'], effects: ['settlePlea'], go: 'refused' },
          { say: 'weBothDriveAway', when: ['demandsToll'], effects: [], go: 'demanded' },
        ],
      },
      demanded: {
        line: 'noFreeRideDump',
        options: [
          { say: 'fineTakeIt', when: [], effects: ['payToll'], go: END },
          { say: 'comeAndGetIt', when: [], effects: ['refuseToll'], go: END },
        ],
      },
      agreed: { line: 'fineKeepYourGuns', options: [{ say: 'overAndOut', when: [], effects: [], go: END }] },
      refused: { line: 'tooLateForTalk', options: [{ say: 'thenWeFinishThis', when: [], effects: [], go: END }] },
    },
  },
  mercy: {
    id: 'mercy',
    once: false,
    ask: { say: 'iGiveUpLet', when: ['atOdds', 'noPlayerPlea'], duringFeud: true },
    raise: null,
    prepare: 'mercyAnswer',
    hangUp: ['withdrawPlea'],
    start: 'listen',
    nodes: {
      listen: {
        line: 'talkFast',
        options: [
          { say: 'takeWhatICarry', when: ['accepts'], effects: ['settlePlea'], go: 'spared' },
          { say: 'takeWhatICarry', when: ['refuses'], effects: ['settlePlea'], go: 'refused' },
        ],
      },
      spared: { line: 'leaveItOnThe', options: [{ say: 'going', when: [], effects: [], go: END }] },
      refused: { line: 'noDeals', options: [{ say: 'thenComeAndGet', when: [], effects: [], go: END }] },
    },
  },
  yieldDemand: {
    id: 'yieldDemand',
    once: false,
    ask: { say: 'yourTruckIsFinished', when: ['atOdds', 'npcBeaten', 'notOfferedYield'], duringFeud: true },
    raise: null,
    prepare: 'yieldAnswer',
    hangUp: [],
    start: 'hear',
    nodes: {
      hear: {
        line: 'youWantToPick',
        options: [
          { say: 'yourCallLastChance', when: ['accepts'], effects: [], go: 'agreed' },
          { say: 'yourCallLastChance', when: ['refuses'], effects: [], go: 'refused' },
        ],
      },
      agreed: { line: 'allRightIAm', options: [{ say: 'sitTight', when: [], effects: ['yieldToPlayer'], go: END }] },
      refused: { line: 'notWhileICan', options: [{ say: 'thenWeFinishThis', when: [], effects: ['settleRefused'], go: END }] },
    },
  },
  rob: {
    id: 'rob',
    once: true,
    ask: { say: 'dropYourCargoOr', when: ['atPeace', 'npcHasCargo'], duringFeud: false },
    raise: null,
    prepare: 'threatAnswer',
    hangUp: ['settleRefused'],
    start: 'hear',
    nodes: {
      hear: {
        line: 'sayThatAgain',
        options: [
          { say: 'youHeardMeCargo', when: ['complies'], effects: ['settleThreat'], go: 'comply' },
          { say: 'youHeardMeCargo', when: ['resists'], effects: ['settleThreat'], go: 'fightBack' },
          { say: 'youHeardMeCargo', when: ['runs'], effects: ['settleThreat'], go: 'flee' },
        ],
      },
      comply: { line: 'allRightItIs', options: [{ say: 'smartChoice', when: [], effects: [], go: END }] },
      fightBack: { line: 'comeAndTakeIt', options: [{ say: 'yourFuneral', when: [], effects: [], go: END }] },
      flee: { line: 'notTodayRun', options: [{ say: 'runThen', when: [], effects: [], go: END }] },
    },
  },
  warnOff: {
    id: 'warnOff',
    once: true,
    ask: { say: 'thisWreckIsMine', when: ['atPeace', 'claimsPlayerLoot'], duringFeud: false },
    raise: null,
    prepare: 'warnAnswer',
    hangUp: ['settleRefused'],
    start: 'hear',
    nodes: {
      hear: {
        line: 'saysWho',
        options: [
          { say: 'youHeardMeLeave', when: ['complies'], effects: ['settleWarning'], go: 'comply' },
          { say: 'youHeardMeLeave', when: ['holdsOn'], effects: ['settleWarning'], go: 'refuse' },
          { say: 'youHeardMeLeave', when: ['resists'], effects: ['settleWarning'], go: 'fightBack' },
        ],
      },
      comply: { line: 'fineItsYours', options: [{ say: 'good', when: [], effects: [], go: END }] },
      refuse: { line: 'findYourOwnWreck', options: [{ say: 'weWillSee', when: [], effects: [], go: END }] },
      fightBack: { line: 'overMyDeadBody', options: [{ say: 'haveItYourWay', when: [], effects: [], go: END }] },
    },
  },
  lootWarning: {
    id: 'lootWarning',
    once: false,
    ask: null,
    raise: { when: ['warnsPlayerOff'], priority: 4, duringFeud: false, duringCombat: false },
    prepare: 'lootWarningTerms',
    hangUp: ['hangUpLootWarning'],
    start: 'warn',
    nodes: {
      warn: {
        line: 'warnTerms',
        options: [
          { say: 'rollingOn', when: [], effects: ['leaveLootWarning'], go: END },
          { say: 'findYourOwn', when: ['yieldsLoot'], effects: ['refuseLootWarning'], go: 'backsOff' },
          { say: 'findYourOwn', when: ['fightsForLoot'], effects: ['refuseLootWarning'], go: 'fights' },
          { say: 'makeMe', when: [], effects: ['fightLootWarning'], go: 'fights' },
        ],
      },
      backsOff: { line: 'keepYourScrapsThen', options: [{ say: 'thoughtSo', when: [], effects: [], go: END }] },
      fights: { line: 'thenWeSettleIt', options: [{ say: 'bringIt', when: [], effects: [], go: END }] },
    },
  },
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
        line: 'enoughOfThisWe',
        options: [
          { say: 'agreedGunsDown', when: [], effects: ['acceptPlea'], go: END },
          { say: 'noWeFinishThis', when: [], effects: ['refusePlea'], go: END },
        ],
      },
    },
  },
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
        line: 'stopShootingIGive',
        options: [
          { say: 'dumpAndDrive', when: [], effects: ['acceptPlea'], go: END },
          { say: 'standDownAndLet', when: ['notOfferedYield'], effects: ['askStandDown'], go: 'strip' },
          { say: 'noMercy', when: [], effects: ['refusePlea'], go: END },
        ],
      },
      strip: {
        line: 'youWantToPick',
        options: [
          { say: 'yourCallLastChance', when: ['accepts'], effects: [], go: 'stripAgreed' },
          { say: 'yourCallLastChance', when: ['refuses'], effects: [], go: 'stripRefused' },
        ],
      },
      stripAgreed: {
        line: 'allRightIAm',
        options: [{ say: 'sitTight', when: [], effects: ['standDownPlea'], go: END }],
      },
      stripRefused: {
        line: 'notWhileICan',
        options: [{ say: 'thenWeFinishThis', when: [], effects: ['refusePlea'], go: END }],
      },
    },
  },
  offerTow: {
    id: 'offerTow',
    once: false,
    ask: { say: 'needATowTo', when: ['canTowNpc'], duringFeud: false },
    raise: null,
    prepare: 'npcTowTerms',
    hangUp: [],
    start: 'terms',
    nodes: {
      terms: {
        line: 'takeMeToSite',
        options: [
          { say: 'dealHitchUp', when: [], effects: ['hitchNpc'], go: END },
          { say: 'noChargeHitchUp', when: [], effects: ['hitchNpcFree'], go: END },
          { say: 'notNowSomethingElse', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
  releaseTow: {
    id: 'releaseTow',
    once: false,
    ask: { say: 'iAmLettingYou', when: ['towedByPlayer'], duringFeud: false },
    raise: null,
    prepare: null,
    hangUp: ['releaseNpc'],
    start: 'released',
    nodes: {
      released: { line: 'fineThanksForThe', options: [{ say: 'overAndOut', when: [], effects: ['releaseNpc'], go: END }] },
    },
  },
  offerPatch: {
    id: 'offerPatch',
    once: false,
    ask: { say: 'yourTruckLooksDead', when: ['npcNeedsPatch', 'npcOffRope', 'atPeace'], duringFeud: false },
    raise: null,
    prepare: 'patchTerms',
    hangUp: [],
    start: 'ask',
    nodes: {
      ask: {
        line: 'youKnowHowThen',
        options: [
          { say: 'whatCanYouOffer', when: ['hasDeal'], effects: [], go: 'terms' },
          { say: 'onSecondThoughtI', when: ['noDeal'], effects: [], go: HUB },
        ],
      },
      terms: {
        line: 'dealTerms',
        options: [
          { say: 'dealStayWhereYou', when: [], effects: ['agreePatch'], go: END },
          { say: 'notNowSomethingElse', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
  offerPatchWorn: {
    id: 'offerPatchWorn',
    once: false,
    ask: { say: 'yourEngineSoundsRough', when: ['npcWorn', 'npcOffRope', 'npcCalm', 'atPeace'], duringFeud: false },
    raise: null,
    prepare: 'patchTerms',
    hangUp: [],
    start: 'ask',
    nodes: {
      ask: {
        line: 'youKnowHowThen',
        options: [
          { say: 'whatCanYouOffer', when: ['hasDeal'], effects: [], go: 'terms' },
          { say: 'onSecondThoughtI', when: ['noDeal'], effects: [], go: HUB },
        ],
      },
      terms: {
        line: 'dealTerms',
        options: [
          { say: 'dealPullOverAnd', when: [], effects: ['agreePatch'], go: END },
          { say: 'notNowSomethingElse', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
  marketNews: {
    id: 'marketNews',
    once: false,
    ask: { say: 'howArePricesIn', when: ['knowsLastTown'], duringFeud: false },
    raise: null,
    prepare: 'lastTownPrices',
    hangUp: [],
    start: 'prices',
    nodes: {
      prices: {
        line: 'lastIWasIn',
        options: [
          { say: 'thanksSomethingElse', when: [], effects: [], go: HUB },
          { say: 'thanksOverAndOut', when: [], effects: [], go: END },
        ],
      },
    },
  },
  rumor: {
    id: 'rumor',
    once: true,
    ask: { say: 'seenAnythingWorthA', when: ['hearsRumor'], duringFeud: false },
    raise: null,
    prepare: 'nearestRumor',
    hangUp: [],
    start: 'tell',
    nodes: {
      tell: {
        line: 'maybeIPassedSomething',
        options: [
          { say: 'where', when: ['rumorOfSite'], effects: [], go: 'site' },
          { say: 'where', when: ['rumorOfWreck'], effects: [], go: 'wreck' },
        ],
      },
      site: {
        line: 'siteBearing',
        options: [
          { say: 'thanksSomethingElse', when: [], effects: ['revealRumor', 'settleDone'], go: HUB },
          { say: 'thanksOverAndOut', when: [], effects: ['revealRumor', 'settleDone'], go: END },
        ],
      },
      wreck: {
        line: 'aWreckNobodyPicked',
        options: [
          { say: 'thanksSomethingElse', when: [], effects: ['revealRumor', 'settleDone'], go: HUB },
          { say: 'thanksOverAndOut', when: [], effects: ['revealRumor', 'settleDone'], go: END },
        ],
      },
    },
  },
  // A driver near the lost Army wagon tells where it saw it, once the player has heard of it at Bowl. It needs no
  // perk and marks nothing: the journal keeps the driver's words. See src/data/locals.ts.
  armyWagon: {
    id: 'armyWagon',
    once: true,
    ask: { say: 'seenADeadArmy', when: ['heardWagonNearby'], duringFeud: false },
    raise: null,
    prepare: null,
    hangUp: [],
    start: 'tell',
    nodes: {
      tell: {
        line: 'armyWagonTold',
        options: [
          { say: 'whatElseDidYouSee', when: [], effects: ['noteWagonRoad', 'settleDone'], go: questGo('radio_wagon_driver') },
          { say: 'thanksSomethingElse', when: [], effects: ['noteWagonRoad', 'settleDone'], go: HUB },
          { say: 'thanksOverAndOut', when: [], effects: ['noteWagonRoad', 'settleDone'], go: END },
        ],
      },
    },
  },
  tips: {
    id: 'tips',
    once: false,
    ask: { say: 'anythingInteresting', when: [], duringFeud: false },
    raise: null,
    prepare: 'tradeTip',
    hangUp: [],
    start: 'tell',
    nodes: {
      tell: {
        line: 'tipTold',
        options: [
          { say: 'thanksSomethingElse', when: [], effects: [], go: HUB },
          { say: 'overAndOut', when: [], effects: [], go: END },
        ],
      },
    },
  },
  buyTruce: {
    id: 'buyTruce',
    once: false,
    ask: { say: 'whatWouldItCost', when: ['atOdds', 'canPayTruce'], duringFeud: true },
    raise: null,
    prepare: 'trucePrice',
    hangUp: [],
    start: 'price',
    nodes: {
      price: {
        line: 'truceCost',
        options: [
          { say: 'dealSendingIt', when: [], effects: ['payTruce'], go: 'paid' },
          { say: 'tooMuch', when: [], effects: [], go: HUB },
        ],
      },
      paid: { line: 'moneyIsInGuns', options: [{ say: 'overAndOut', when: [], effects: [], go: END }] },
    },
  },
  offerAid: {
    id: 'offerAid',
    once: false,
    ask: { say: 'runningLowICan', when: ['noAid', 'atPeace', 'npcCalm', 'npcLow', 'npcOffRope'], duringFeud: false },
    raise: null,
    prepare: 'aidWanted',
    hangUp: [],
    start: 'terms',
    nodes: {
      terms: {
        line: 'iCouldUseAid',
        options: [
          { say: 'dealPlain', when: [], effects: ['giveAidPaid'], go: END },
          { say: 'noCharge', when: [], effects: ['giveAidFree'], go: END },
          { say: 'notNowSomethingElse', when: [], effects: [], go: HUB },
        ],
      },
    },
  },
  askAid: {
    id: 'askAid',
    once: true,
    ask: { say: 'iAmRunningDry', when: ['noAid', 'atPeace', 'npcCalm', 'playerLow'], duringFeud: false },
    raise: null,
    prepare: 'aidAnswer',
    hangUp: ['settleRefused'],
    start: 'check',
    nodes: {
      check: {
        line: 'letMeCheckMy',
        options: [
          { say: 'whateverYouCanSpare', when: ['aidGiven'], effects: [], go: 'give' },
          { say: 'whateverYouCanSpare', when: ['aidRefused'], effects: ['settleRefused'], go: 'refuse' },
        ],
      },
      give: {
        line: 'iCanSpareAid',
        options: [{ say: 'thanksIWillWait', when: [], effects: ['takeAid', 'settleDone'], go: END }],
      },
      refuse: { line: 'sorryCannotSpareAny', options: [{ say: 'understood', when: [], effects: [], go: HUB }] },
    },
  },
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
        line: 'youLookDryI',
        options: [
          { say: 'thanksIWillWait', when: [], effects: ['acceptAidOffer'], go: END },
          { say: 'noThanks', when: [], effects: ['refuseAidOffer'], go: END },
        ],
      },
    },
  },
};

// How a driver talks. The first of its traits with a voice speaks for it.
export type Voice = {
  greeting: LineId;
  repeatLine: LineId;
  refusal: LineId;
  warnOff: LineId;
  honksBack: boolean;
};

export type TraitTalk = { voice: Voice | null; topics: TopicId[] };

export const HONK_RANGE = DETECT.sound.limp;

const PARLEY: TopicId[] = ['spillClaim', 'surrender', 'giveUp', 'claim', 'truce', 'mercy', 'yieldDemand', 'buyTruce', 'rob', 'lootWarning', 'warnOff', 'truceOffer', 'mercyPlea', 'offerTow', 'releaseTow', 'offerPatch', 'offerPatchWorn', 'offerAid'];

export const TRAIT_TALK: Record<TraitId, TraitTalk> = {
  trader: { voice: { greeting: 'goAhead', repeatLine: 'weAlreadyTalkedAbout', refusal: 'nothingToSayTo', warnOff: 'thisOneIsSpokenFor', honksBack: true }, topics: ['directions', 'marketNews', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', 'patch', 'patchRequest', 'trade', ...PARLEY] },
  scavenger: { voice: { greeting: 'yeahMakeItQuick', repeatLine: 'iToldYouAlready', refusal: 'getOffMyChannel', warnOff: 'thatsMyPick', honksBack: true }, topics: ['directions', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', 'patch', 'patchRequest', 'trade', ...PARLEY] },
  raider: { voice: { greeting: 'getLost', repeatLine: 'getLost', refusal: 'hehNo', warnOff: 'offMyLootNow', honksBack: false }, topics: ['demand', ...PARLEY] },
  scumbag: { voice: null, topics: ['demand', ...PARLEY] },
  coward: { voice: null, topics: PARLEY },
  brave: { voice: null, topics: PARLEY },
  lawman: { voice: { greeting: 'speakUp', repeatLine: 'heardYouTheFirst', refusal: 'clearTheChannel', warnOff: 'leaveThatSalvageBe', honksBack: true }, topics: ['directions', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', ...PARLEY] },
  courier: { voice: { greeting: 'makeItShort', repeatLine: 'saidThatAlready', refusal: 'noTimeOut', warnOff: 'imTakingThatOne', honksBack: true }, topics: ['directions', 'marketNews', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', 'trade', ...PARLEY] },
  roamer: { voice: { greeting: 'whatDoYouWant', repeatLine: 'oldNewsFriend', refusal: 'notTalking', warnOff: 'sawThisOneFirst', honksBack: true }, topics: ['directions', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', 'patch', 'patchRequest', 'trade', ...PARLEY] },
  vulture: { voice: { greeting: 'keepItShort', repeatLine: 'alreadySaid', refusal: 'nothingForYou', warnOff: 'mineGoPickAnother', honksBack: false }, topics: ['directions', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'patchRequest', 'trade', ...PARLEY] },
  supplier: { voice: { greeting: 'listening', repeatLine: 'weCoveredThat', refusal: 'keepOffThisChannel', warnOff: 'weAreTakingThisOne', honksBack: true }, topics: ['directions', 'marketNews', 'rumor', 'armyWagon', 'tips', 'tow', 'towFree', 'askTow', 'askAid', 'aidOffer', 'trade', ...PARLEY] },
  guard: { voice: { greeting: 'stateYourBusiness', repeatLine: 'heardYou', refusal: 'moveAlong', warnOff: 'backAwayFromThat', honksBack: false }, topics: ['directions', ...PARLEY] },
  merc: { voice: { greeting: 'talk', repeatLine: 'youSaidThat', refusal: 'notInterested', warnOff: 'thatsMineWalkAway', honksBack: false }, topics: ['directions', ...PARLEY] },
};
