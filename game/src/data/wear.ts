// Wear and field repair numbers. All survival-loop wear and repair rule numbers live here, not in rules.ts.

// Part condition. A part gains one wear step each time it drops to 0 HP. See src/sim/condition.ts.
export const CONDITION = {
  maxWear: 4,
  valueFactor: [1, 0.7, 0.55, 0.45, 0.35],
  stepLoss: 0.027,
  speedLoss: {
    speedBonus: 0.26,
    accelBonus: 0.1,
  },
  reloadPercent: 10,
};

export const WEAR = {
  chancePerTile: 0.00055,
  hpShare: 0.02,
  speedWeight: 0.03,
  breakdownChancePerTile: 0.0001,
  breakdownHpShare: 0.15,
  failureChancePerTile: 0.000017,
};

export const PATCH = {
  share: 0.25,
  laborPerTurn: 266.67,
};

export const REPAIR = {
  fieldCapShare: 0.7,
  turnsPerPart: 2,
};

export const ENGINE_HEAT = {
  gain: 0.043125,
  coolDriving: 0.024,
  coolParked: 0.15,
  warnAt: 0.75,
  overheatDamage: 2,
  overdriveGain: 0.09,
  douseSupplies: 1,
  douseCool: 0.5,
};

export const HAZE_FROM = 1 + ENGINE_HEAT.coolDriving / ENGINE_HEAT.gain;
