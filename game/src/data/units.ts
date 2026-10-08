// Real-world units for display. The sim keeps its own units: tiles, turns, fuel units, grid cells and heat multipliers.

export const UNITS = {
  // Money in the sim and data is integer cents. 100 cents is 1 M, the price of 5 L of fuel at a town.
  centsPerM: 100,
  fuelLiters: 5, // liters in one fuel unit; a scout pickup tank holds 200 L and burns about 23 L per 100 km
  cellDepth: 0.5, // meters of cargo height over one grid cell, the same as its width, so a cell holds 125 L
  shadeCelsius: 22, // air temperature at heat 1: night, shade or the sun at the horizon
  celsiusPerHeat: 12, // degrees per heat above 1; full noon sun at heat 2.5 reads 40 °C
  engineColdCelsius: 80, // engine gauge at heat 0
  engineHotCelsius: 120, // engine gauge at heat 1, overheated
  currency: { one: 'M', many: "M's" }, // the display name of the sim's money
};
