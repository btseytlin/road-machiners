// The game's modal screens: the town and truck trade screens, and the character, journal and inventory screens the
// player toggles with a key. At most one is open: opening a toggled screen closes the others. The talk window lies
// over them while a quest is live, and only leaving the quest closes it.

import { CharacterScreen } from "../ui/character";
import type { UiHost } from "../ui/host";
import { FullShopScreen } from "../ui/full-shop";
import { InventoryScreen } from "../ui/inventory";
import { JournalScreen } from "../ui/journal";
import { QuestScreen } from "../ui/quest-screen";
import { TownScreen, TruckTradeScreen } from "../ui/town";

type Toggled = CharacterScreen | JournalScreen | InventoryScreen;

export class ModalScreens {
  readonly town: TownScreen;
  readonly fullShop: FullShopScreen;
  readonly trade: TruckTradeScreen;
  readonly character: CharacterScreen;
  readonly journal: JournalScreen;
  readonly inventory: InventoryScreen;
  readonly quest: QuestScreen;

  constructor(host: UiHost) {
    this.town = new TownScreen(host);
    this.fullShop = new FullShopScreen(host);
    this.trade = new TruckTradeScreen(host);
    this.character = new CharacterScreen(host);
    this.journal = new JournalScreen(host);
    this.inventory = new InventoryScreen(host);
    this.quest = new QuestScreen(host);
  }

  private all(): (TownScreen | FullShopScreen | TruckTradeScreen | Toggled)[] {
    return [this.town, this.fullShop, this.trade, this.character, this.journal, this.inventory];
  }

  anyOpen(): boolean {
    return this.quest.isOpen() || this.all().some((s) => s.isOpen());
  }

  render(): void {
    for (const s of this.all()) s.render();
    this.quest.render();
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
