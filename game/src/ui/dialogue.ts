// The radio call panel and dialogue text. The panel shows who is on the line, what they said, and the
// numbered replies. While it is open, keys 1 to 9 pick a reply and Escape hangs up. Otherwise T calls the
// inspected truck and H honks.

import { DEAL_LINES, TIP_LINES } from '../data/dialogue';
import { GOODS } from '../data/goods';
import { REGION } from '../data/region';
import { FACTION_COLORS } from '../render/palette';
import { playerVehicle, vehicleById } from '../sim/damage';
import { isKnockedOut } from '../sim/defeat';
import { callVehicle, chooseOption, currentOptions, hangUp, honk } from '../sim/dialogue';
import type { CallVar, CallVars, GameEvent, World } from '../sim/types';
import { playerSees } from '../sim/vision';
import { playerCanAct } from '../sim/world';
import { el, isBrowserChord, panel } from './dom';
import { fuelLiters, meters } from './units';
import { npcName } from '../sim/spawn';

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const METERS_PER_KM = 1000;

// Map +x is east and +y is south, so a bearing of 0 points east and turns clockwise.
function compass(rad: number): string {
  const step = (2 * Math.PI) / COMPASS.length;
  const i = Math.round(rad / step);
  return COMPASS[((i % COMPASS.length) + COMPASS.length) % COMPASS.length];
}

function townName(id: string): string {
  const town = REGION.towns.find((t) => t.id === id);
  if (!town) throw new Error(`Unknown town ${id}`);
  return town.name;
}

function siteName(id: string): string {
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === id);
  if (!site) throw new Error(`Unknown site ${id}`);
  return site.name;
}

function distanceText(tiles: number): string {
  const m = meters(tiles);
  return m >= METERS_PER_KM ? `${(m / METERS_PER_KM).toFixed(1)} km` : `${m} m`;
}

// A patch deal in words, from the NPC's side, with its numbers filled in.
function dealText(v: Extract<CallVar, { kind: 'deal' }>): string {
  const line = DEAL_LINES[v.deal][v.patcher === 'player' ? 'playerPatches' : 'npcPatches'];
  return fillLine(line, { price: { kind: 'money', amount: v.price }, parts: { kind: 'count', n: v.parts, unit: 'part' } });
}

// A town's goods prices in words: "salt buy 14 sell 9, grain buy 6 sell 4".
function pricesText(v: Extract<CallVar, { kind: 'prices' }>): string {
  return v.goods.map((g) => `${GOODS[g.good].name.toLowerCase()} buy ${g.buy} sell ${g.sell}`).join(', ');
}

// Fuel and supplies in words: "12 L of fuel and 3 supplies", leaving out a zero part.
function aidText(v: Extract<CallVar, { kind: 'aid' }>): string {
  const parts = [
    ...(v.fuel > 0 ? [`${fuelLiters(v.fuel)} L of fuel`] : []),
    ...(v.supplies > 0 ? [`${v.supplies} ${v.supplies === 1 ? 'supply' : 'supplies'}`] : []),
  ];
  if (parts.length === 0) throw new Error('Aid of no fuel and no supplies is never named in a line');
  return parts.join(' and ');
}

// A trading tip in words: the site and the good, never a number.
export function tipText(v: Extract<CallVar, { kind: 'tip' }>): string {
  if (!v.tip) return TIP_LINES.none;
  const line = v.tip.dear ? TIP_LINES.dear : TIP_LINES.cheap;
  const good = GOODS[v.tip.good];
  return line.replace('{site}', siteName(v.tip.shop)).replace('{good}', good.name.toLowerCase()).replace('{was}', good.plural ? 'were' : 'was');
}

type VarText = { [K in CallVar['kind']]: (v: Extract<CallVar, { kind: K }>) => string };

const VAR_TEXT: VarText = {
  town: (v) => townName(v.id),
  site: (v) => siteName(v.id),
  money: (v) => String(v.amount),
  distance: (v) => distanceText(v.tiles),
  bearing: (v) => compass(v.rad),
  count: (v) => `${v.n} ${v.n === 1 ? v.unit : `${v.unit}s`}`,
  deal: dealText,
  prices: pricesText,
  aid: aidText,
  tip: tipText,
  answer: () => { throw new Error('A rolled answer is never shown in a line'); },
};

function formatVar<K extends CallVar['kind']>(v: Extract<CallVar, { kind: K }>): string {
  return (VAR_TEXT[v.kind as K] as (x: typeof v) => string)(v);
}

export function fillLine(text: string, vars: CallVars): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = vars[name];
    if (!v) throw new Error(`Line "${text}" needs the call value ${name}`);
    return formatVar(v);
  });
}

function isTyping(): boolean {
  return document.activeElement?.matches('input, select, textarea') ?? false;
}

// Whether T would call this vehicle now: an awake NPC driver the player sees, while the player can act.
export function canCall(w: World, id: string): boolean {
  const v = w.vehicles.find((x) => x.id === id);
  return !!v?.brain && !isKnockedOut(v) && playerCanAct(w) && playerSees(w, v.pos);
}

export type DialogueHost = {
  world(): World;
  talk(next: World): void; // apply a dialogue command and log its lines
  inspected(): string | null; // the pinned vehicle, else the one under the cursor
  busy(): boolean; // a turn plays
  commit(next: World): void; // take a honked world without pausing travel
  log(next: World): void; // log the events of a command
  playHorn(vehicleId: string, delayMs: number): void; // sound one truck's horn where it is drawn
};

const HONK_REPLY_MS = 500; // a driver takes a moment to answer a horn

// The player's horn. It sounds at once, also while a turn plays. A command clears the world's turn events, which a
// playing turn still shows, so a horn during playback sends its command once the playback ends. The finished turn's
// events stay after a honk, so travel still sees what stopped the truck. Travel goes on either way.
class Horn {
  private queued = false;

  constructor(private readonly host: DialogueHost) {}

  sound(): void {
    if (!this.host.busy()) return this.send(false);
    if (this.queued) return;
    this.queued = true;
    this.host.playHorn(playerVehicle(this.host.world()).id, 0);
  }

  // Sends a horn pressed during the turn that just ended. A rescue command run at that end may have put the truck on
  // a rope, and a towed driver cannot honk.
  flush(): void {
    if (this.queued && playerCanAct(this.host.world())) this.send(true);
    this.queued = false;
  }

  // The player's horn at once, then each answer a beat later, nearest first. Answers come only from earshot, so
  // unseen trucks are heard.
  private send(ownHornPlayed: boolean): void {
    const before = this.host.world();
    const next = honk(before);
    this.host.log(next);
    this.host.commit({ ...next, events: [...before.events, ...next.events], removed: before.removed });
    const honks = next.events.filter((e): e is Extract<GameEvent, { t: "honk" }> => e.t === "honk");
    honks.forEach((e, i) => {
      if (i > 0 || !ownHornPlayed) this.host.playHorn(e.vehicle, i * HONK_REPLY_MS);
    });
  }
}


const KEY_DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

export class DialoguePanel {
  private readonly root = panel('dialogue');
  private readonly horn: Horn;

  // Keys go through the capture phase, so an open call takes 1 to 9 and Escape before the game sees them.
  constructor(private readonly host: DialogueHost) {
    this.horn = new Horn(host);
    this.root.style.display = 'none';
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  render(w: World): void {
    const call = w.player.call;
    this.root.style.display = call ? '' : 'none';
    if (!call) return this.root.replaceChildren();
    const npc = vehicleById(w, call.with);
    this.root.style.borderLeftColor = `#${FACTION_COLORS[npc.faction].top.toString(16).padStart(6, '0')}`;
    const options = currentOptions(w).map((o, i) =>
      el('button', { class: 'dialogue-option', onclick: () => this.choose(i) }, `${i + 1}. ${o.text}`),
    );
    this.root.replaceChildren(
      el('div', { class: 'dialogue-speaker' }, `Radio: ${npcName(npc)}`),
      el('div', { class: 'dialogue-line' }, `“${fillLine(call.line.text, call.line.vars)}”`),
      el('div', { class: 'dialogue-options' }, ...options),
    );
  }

  private onKey(e: KeyboardEvent): void {
    if (isBrowserChord(e) || isTyping()) return;
    if (this.host.busy()) return this.onBusyKey(e);
    const handled = this.host.world().player.call ? this.onCallKey(e.code) : this.onFreeKey(e.code);
    if (handled) e.stopImmediatePropagation();
  }

  private onFreeKey(code: string): boolean {
    if (code === 'KeyT') return this.callInspected();
    return code === 'KeyH' && this.honk();
  }

  // While a turn plays, only the horn works.
  // Sends a horn pressed during the turn that just ended.
  flushHorn(): void {
    this.horn.flush();
  }

  private onBusyKey(e: KeyboardEvent): void {
    if (e.code === 'KeyH' && this.honk()) e.stopImmediatePropagation();
  }

  private honk(): boolean {
    if (!playerCanAct(this.host.world())) return false;
    this.horn.sound();
    return true;
  }

  private onCallKey(code: string): boolean {
    if (code === 'Escape') {
      this.host.talk(hangUp(this.host.world()));
      return true;
    }
    const index = KEY_DIGITS.indexOf(code);
    if (index >= 0 && index < currentOptions(this.host.world()).length) this.choose(index);
    return index >= 0;
  }

  private choose(index: number): void {
    this.host.talk(chooseOption(this.host.world(), index));
  }

  // Calls the inspected truck when it can take a call. Returns whether a call was made.
  private callInspected(): boolean {
    const id = this.host.inspected();
    if (!id || !canCall(this.host.world(), id)) return false;
    this.host.talk(callVehicle(this.host.world(), id));
    return true;
  }
}
