// Real-world units for display. The sim keeps its own units: tiles, turns, fuel units, grid cells and heat multipliers.

export const UNITS = {
  centsPerM: 100,
  fuelLiters: 5,
  cellDepth: 0.5,
  shadeCelsius: 22,
  celsiusPerHeat: 12,
  engineColdCelsius: 80,
  engineHotCelsius: 120,
  currency: { one: 'M', many: "M's" }, // the display name of the sim's money
};
