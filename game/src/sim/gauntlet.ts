import type { RunLossCause, World } from './types';

export function endRun(world: World, cause: RunLossCause): void {
  const run = world.gauntlet;
  if (!run) throw new Error(`A run ends by ${cause} in a world with no run`);
  if (world.player.state === 'dead') throw new Error('The run has already ended');
  world.player.state = 'dead';
  world.events.push({ t: 'runLost', stretch: run.stretch + 1, cause });
}
