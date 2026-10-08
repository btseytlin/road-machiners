// The clock. One turn is one step of the day; hours run 0 to 24.

export const TIME = {
  turnsPerDay: 450,
  startHour: 7,
  sunrise: 6,
  sunset: 20,
  noonElevation: 40,
  sunHeat: 2.5,
  nightSight: 0.5,
  shadeAlpha: 0.35,
  shadeFadeElevation: 10,
  shadeReach: 25,
  shadeSamples: 20,
  obstacleShade: { rock: 1.2, wreck: 1.6, building: 2.5 } as Record<
    string,
    number
  >,
};
