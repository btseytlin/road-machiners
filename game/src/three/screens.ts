import { CharacterScreen } from "../ui/character";
import type { UiHost } from "../ui/host";
import { FullShopScreen } from "../ui/full-shop";
import { InventoryScreen } from "../ui/inventory";
import { JournalScreen } from "../ui/journal";
import { OutpostScreen } from "../ui/outpost";
import { QuestScreen } from "../ui/quest-screen";
import { TownScreen, TruckTradeScreen } from "../ui/town";

type Toggled = CharacterScreen | JournalScreen | InventoryScreen;

export class ModalScreens {
  readonly town: TownScreen;
  readonly outpost: OutpostScreen;
  readonly fullShop: FullShopScreen;
  readonly trade: TruckTradeScreen;
  readonly character: CharacterScreen;
  readonly journal: JournalScreen;
  readonly inventory: InventoryScreen;
  readonly quest: QuestScreen;

  constructor(host: UiHost) {
    this.town = new TownScreen(host);
    this.outpost = new OutpostScreen(host);
    this.fullShop = new FullShopScreen(host);
    this.trade = new TruckTradeScreen(host);
    this.character = new CharacterScreen(host);
    this.journal = new JournalScreen(host);
    this.inventory = new InventoryScreen(host);
    this.quest = new QuestScreen(host);
  }

  private all(): (TownScreen | OutpostScreen | FullShopScreen | TruckTradeScreen | Toggled)[] {
    return [this.town, this.outpost, this.fullShop, this.trade, this.character, this.journal, this.inventory];
  }

  anyOpen(): boolean {
    return this.quest.isOpen() || this.all().some((s) => s.isOpen());
  }

  blockingOpen(): boolean {
    return this.quest.isOpen() || this.all().some((s) => s !== this.inventory && s.isOpen());
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
