// What the HTML overlay needs from the game scene.

import type { World } from "../sim/types";

export type UiHost = {
  world(): World;
  apply(next: World): void; // replace the world after a command and refresh the UI
  announce(next: World): void; // apply, then log the command's events and play their sting
  selectedWeapon(): string | null;
  selectWeapon(id: string | null): void;
  selectedUtility(): string | null; // the point utility waiting for its target click
  selectUtility(id: string | null): void;
  pressTurn(): void; // a turn press, as Space keydown
  releaseTurn(): void; // as Space keyup
  runKey(code: string): void; // runs a key's action under that key's gates
  autoTravel(): boolean;
  getTurnPhase(): "Moving" | "Firing" | "Results" | null;
};
