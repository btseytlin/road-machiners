// Towing a stranded player to town, and the emergency beacon that calls for it. See src/sim/tow.ts.

import { DETECT } from './detect';

export const TOW = {
  base: 40,
  perTile: 1.5,
  gap: 2,
  speedShare: 0.6,
};

export const BEACON = {
  range: 250,
  radius: DETECT.fuzz.base,
};
