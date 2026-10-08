// Towing a stranded player to town, and the emergency beacon that calls for it. See src/sim/tow.ts.

import { DETECT } from './detect';
import { EFFORT } from './market';

const WAGES = 2;
const APPROACH_TURNS = 25;
const TURNS_PER_TILE = 0.9;
const CAP_TURNS = 225;
const TURN_PRICE = EFFORT.wage[1] * WAGES;

export const TOW = {
  wages: WAGES,
  approachTurns: APPROACH_TURNS,
  turnsPerTile: TURNS_PER_TILE,
  capTurns: CAP_TURNS,
  base: APPROACH_TURNS * TURN_PRICE,
  perTile: TURNS_PER_TILE * TURN_PRICE,
  maxFee: CAP_TURNS * TURN_PRICE,
  dangerWait: 10,
  gap: 2,
  takeUp: 1.5,
  speedShare: 0.6,
};

export const BEACON = {
  range: 250,
  radius: DETECT.fuzz.base,
};
