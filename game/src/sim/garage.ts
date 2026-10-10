import { reachedOutpostAt } from './fury-road';
import { shopAt } from './market';
import type { World } from './types';

export function atGarage(world: World): boolean {
  return shopAt(world) !== null || reachedOutpostAt(world) !== null;
}

export function requireGarage(world: World): void {
  if (!atGarage(world)) throw new Error('Not parked at a garage');
}
