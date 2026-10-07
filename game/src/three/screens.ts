// The game's modal screens: the town and truck trade screens, and the character, journal and inventory screens the
// player toggles with a key. At most one is open: opening a toggled screen closes the others.

import { CharacterScreen } from "../ui/character";
import type { UiHost } from "../ui/host";
import { InventoryScreen } from "../ui/inventory";
import { JournalScreen } from "../ui/journal";
import { TownScreen, TruckTradeScreen } from "../ui/town";

type Toggled = CharacterScreen | JournalScreen | InventoryScreen;

export class ModalScreens {
  readonly town: TownScreen;
  readonly trade: TruckTradeScreen;
  readonly character: CharacterScreen;
  readonly journal: JournalScreen;
  readonly inventory: InventoryScreen;

  constructor(host: UiHost) {
    this.town = new TownScreen(host);
    this.trade = new TruckTradeScreen(host);
    this.character = new CharacterScreen(host);
    this.journal = new JournalScreen(host);
    this.inventory = new InventoryScreen(host);
  }

  private all(): (TownScreen | TruckTradeScreen | Toggled)[] {
    return [this.town, this.trade, this.character, this.journal, this.inventory];
  }

  anyOpen(): boolean {
    return this.all().some((s) => s.isOpen());
  }

  render(): void {
    for (const s of this.all()) s.render();
  }

  // Closes every screen but `keep`.
  closeAll(keep: Toggled | null): void {
    for (const s of this.all()) if (s !== keep) s.close();
  }

  toggle(screen: Toggled): void {
    this.closeAll(screen);
    screen.toggle();
  }
}
