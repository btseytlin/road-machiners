// What the HTML overlay needs from the game scene.

import type { World } from "../sim/types";

export type UiHost = {
  world(): World;
  apply(next: World): void;
  announce(next: World): void;
  selectedWeapon(): string | null;
  selectWeapon(id: string | null): void;
  selectedUtility(): string | null;
  selectUtility(id: string | null): void;
  pressTurn(): void;
  releaseTurn(): void;
  runKey(code: string): void;
  autoTravel(): boolean;
  getTurnPhase(): "Moving" | "Firing" | "Results" | null;
};
