// Towing a stranded player to town, and the emergency beacon that calls for it. See src/sim/tow.ts.

import { DETECT } from './detect';
import { EFFORT } from './market';

const WAGES = 2;
const APPROACH_TURNS = 25;
const TURNS_PER_TILE = 0.9;
const CAP_TURNS = 225;
const TURN_PRICE = EFFORT.wage[1] * WAGES;

export const TOW = {
  // Money per turn of the tower's time, in tier-1 wages. A haul pays 2.5 wages per round-trip turn for cargo
  // risk. A tow carries no cargo and ends at a town the tower uses anyway, so it pays 2.
  wages: WAGES,
  // Turns the tower spends to reach the truck and hitch up, whatever the route.
  approachTurns: APPROACH_TURNS,
  // Turns the tower spends per tile of route while towing. It drives at `speedShare` of its top speed, and a
  // Bowl to Nose road crossing takes 100 to 150 turns at full speed over about 240 tiles.
  turnsPerTile: TURNS_PER_TILE,
  // Turns of tower time after which the fee stops growing: half a day, so the cap is about one day of tier-1
  // salvage.
  capTurns: CAP_TURNS,
  // Money for any tow, however short: the approach turns at the wage.
  base: APPROACH_TURNS * TURN_PRICE,
  // Money per tile of route to the town gate: the turns per tile at the wage.
  perTile: TURNS_PER_TILE * TURN_PRICE,
  // The most a tow costs before the Social cut.
  maxFee: CAP_TURNS * TURN_PRICE,
  // Turns a tower that left a hitched truck for danger waits before it hitches again. A hostile at the edge of sight
  // comes and goes within a few turns, and a tower that hitched at once dropped the tow again the next turn. Ten turns
  // ended about two thirds of those hitch and drop pairs in the progression runs.
  dangerWait: 10,
  // Tiles between the tower's center and the towed truck's center when the tow bar is straight. Two tiles is 8 m,
  // about one and a half truck
  // lengths, and more than the two largest chassis radii together, so the two trucks never overlap on a straight.
  gap: 2,
  // The most the towed truck's front axle moves per substep, as a multiple of the hitch's own move. It closes the
  // slack at hitching smoothly instead of in one jump.
  takeUp: 1.5,
  // Share of its top speed the tower drives at. It drives with care, so the towed truck does not swing out.
  speedShare: 0.6,
};

export const BEACON = {
  // Tiles the beacon reaches, through hills. The map is 600 tiles across. The nearest trader or scavenger to a
  // stranded truck on the main roads was 75 to 170 tiles away over 600 turns. 250 tiles covers that with margin
  // for a helper on the far side of its route, yet stays under half the map, so one call never draws everyone.
  range: 250,
  // Contact circle radius in tiles: the smallest circle any contact has. The beacon names the truck, so every
  // listener trusts it at any distance, and a driver that reaches the circle is close enough to see the truck.
  radius: DETECT.fuzz.base,
};
