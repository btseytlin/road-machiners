// Wear and field repair numbers. All survival-loop wear and repair rule numbers live here, not in rules.ts.

// Part condition. A part gains one wear step each time it drops to 0 HP. See src/sim/condition.ts.
export const CONDITION = {
  maxWear: 4, // last wear step a broken part can be rebuilt from; one more makes it junk
  hpLoss: 0.1, // share of def max HP lost per wear step, for every part kind
  // Value factor per wear step, indexed by wear (0 = pristine). A pristine part carries a heavy premium
  // over one wear step in, so the drop from step 0 to 1 is much steeper than later steps. One entry per
  // step up to maxWear; a junk part past the last step is worth its scrap value only (see sim/wear.ts).
  valueFactor: [1, 0.7, 0.55, 0.45, 0.35],
  // Job stat loss per wear step. Cargo and core parts lose max HP only.
  statLoss: {
    spread: 0.15, // share of weapon spread added
    speedBonus: 0.26, // engine top speed bonus lost, in tiles per turn, a fifth of the smallest engine step
    accelBonus: 0.1, // engine acceleration bonus lost, in the chassis accel unit
    armor: 0.12, // share of an armor part's armor lost
    scannerRange: 0.1, // share of scanner range lost
  },
};

export const WEAR = {
  // A scout at top speed covers about 22,000 off-road tiles per hour of play, at about 1.25 s per turn.
  // At these rates each part then loses about 30% of its max HP, one field repair's worth,
  // and the truck has about three breakdowns. Roads wear at half rate.
  chancePerTile: 0.00055, // per mounted part, per tile driven, at terrain wear 1 and zero speed
  hpShare: 0.02, // share of max HP lost on a plain wear hit, so small and large parts decline alike
  speedWeight: 0.03, // extra chance per tile of speed, as a multiplier on the base chance
  breakdownChancePerTile: 0.0001, // per vehicle, per tile driven
  breakdownHpShare: 0.15, // share of max HP a breakdown takes off the chosen part
  // A failure breaks the engine or the transmission outright, so the truck strands. At these rates a scout at
  // top speed fails about once in two hours of play. A driver without parts for a field repair needs help.
  failureChancePerTile: 0.000017, // per vehicle, per tile driven
};

// A roadside patch between two trucks. See src/sim/patch.ts.
export const PATCH = {
  share: 0.25, // share of max HP a patch gives a broken engine, transmission or tank: enough to drive, not to trust
  laborPerTurn: 266.67, // cents per turn of work on the paid and own-parts deals, a little under a unit of parts
};

export const REPAIR = {
  fieldCapShare: 0.7, // field repair never lifts a part above this share of its max HP
  turnsPerPart: 2, // turns the job takes per unit of parts spent
};

// Engine heat for the player truck. 0 is a cold engine and 1 is overheated. The sun heats a running
// engine; shade, night and parking cool it. Full noon sun overheats a cold stock engine in about 25 turns
// at top speed and 47 at 70% of it. Morning and evening sun barely warm it. Each engine's heat scales both the
// gain and the airflow cooling. Every engine overheats on the shortest Bowl to Nose trip at top speed from 10:00.
export const ENGINE_HEAT = {
  gain: 0.043125, // heat per turn per unit of sun heat above 1, at top speed; scales with speed share
  coolDriving: 0.024, // heat lost per turn to airflow while driving
  coolParked: 0.15, // heat lost per turn while parked, divided by the sun heat at the spot
  warnAt: 0.75, // heat at which the log warns once and the gauge turns red
  overheatDamage: 2, // HP each working engine loses per turn driven while overheated
  // Extra heat per turn driven in overdrive, in any sun. Overheats a cold stock engine at top speed in about 16
  // turns at night and 8 in full noon sun.
  overdriveGain: 0.09,
  douseSupplies: 1, // supplies poured over the engine to cool it at once
  douseCool: 0.5, // heat one douse takes away
};

// Sun heat from which the ground shimmers in heat haze. Above it airflow no longer cools a truck at top
// speed, so any driving engine heats up there. Noon sun heat is 2.5.
export const HAZE_FROM = 1 + ENGINE_HEAT.coolDriving / ENGINE_HEAT.gain;
