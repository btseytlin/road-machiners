// The radio call panel and dialogue text. The panel shows who is on the line, what they said, and the
// numbered replies. While it is open, keys 1 to 9 pick a reply and Escape hangs up. Otherwise T calls the
// inspected truck and H honks.

import type { LineId } from '../data/dialogue';
import { FACTION_COLORS } from '../render/palette';
import { playerVehicle, vehicleById } from '../sim/damage';
import { isKnockedOut } from '../sim/defeat';
import { callVehicle, chooseOption, currentOptions, hangUp, honk } from '../sim/dialogue';
import type { CallVar, CallVars, GameEvent, World } from '../sim/types';
import { playerSees } from '../sim/vision';
import { playerCanAct } from '../sim/world';
import { language, say } from '../text/language';
import { byId, list, t, type Msg } from '../text/msg';
import { goodLower, lineKey, partName, siteName, unitCount, vehicleTitle } from '../text/names';
import { schemaOf } from '../text/resolve';
import { modeRules } from '../sim/settings';
import { el, isBrowserChord, panel, topCenter } from './dom';
import { renderLine } from './quest-text';
import { fuelLiters, meters, moneyM } from './units';

const COMPASS = ['east', 'southEast', 'south', 'southWest', 'west', 'northWest', 'north', 'northEast'] as const;
const METERS_PER_KM = 1000;

// Map +x is east and +y is south, so a bearing of 0 points east and turns clockwise.
function compass(rad: number): Msg {
  const step = (2 * Math.PI) / COMPASS.length;
  const i = Math.round(rad / step);
  return t(`compass.${COMPASS[((i % COMPASS.length) + COMPASS.length) % COMPASS.length]}`);
}

function distanceText(tiles: number): Msg {
  const m = meters(tiles);
  return m >= METERS_PER_KM ? t('call.km', { km: m / METERS_PER_KM }) : t('call.m', { m });
}

const money = (amount: number): Msg => t('call.money', { amount: moneyM(amount) });

// A patch deal in words, from the NPC's side, with its numbers filled in.
function dealText(v: Extract<CallVar, { kind: 'deal' }>): Msg {
  const parts = unitCount('part', v.parts);
  if (v.deal === 'free') return t(`deal.free.${v.patcher}`, { parts });
  return t(`deal.${v.deal}.${v.patcher}`, { price: money(v.price), parts });
}

// A town's goods prices in words: "salt buy 14 sell 9, grain buy 6 sell 4".
function pricesText(v: Extract<CallVar, { kind: 'prices' }>): Msg {
  return list(v.goods.map((g) => t('call.price', { good: goodLower(g.good), buy: money(g.buy), sell: money(g.sell) })));
}

// Fuel and supplies in words: "12 L of fuel and 3 supplies", leaving out a zero part.
export function aidWords(fuel: number, supplies: number): Msg {
  const parts = [
    ...(fuel > 0 ? [t('call.fuel', { liters: fuelLiters(fuel) })] : []),
    ...(supplies > 0 ? [t('call.supplies', { n: supplies })] : []),
  ];
  if (parts.length === 0) throw new Error('Aid of no fuel and no supplies is never named in a line');
  return parts.length === 2 ? t('call.aid', { fuel: parts[0], supplies: parts[1] }) : parts[0];
}

// A trading tip in words: the site and the good, never a number.
export function tipText(v: Extract<CallVar, { kind: 'tip' }>): Msg {
  if (!v.tip) return t('tip.none');
  const words = { site: siteName(v.tip.shop), subject: byId(`good.${v.tip.good}.subject`) };
  return v.tip.dear ? t('tip.dear', words) : t('tip.cheap', words);
}

export function haulText(v: Extract<CallVar, { kind: 'haul' }>): Msg {
  const names = [
    ...Object.entries(v.goods).map(([good, n]) => t('call.haulGood', { n, good: goodLower(good) })),
    ...v.parts.map((id) => t('call.haulPart', { part: partName(id) })),
  ];
  if (names.length === 0) throw new Error('An empty haul is never named in a line');
  return list(names);
}

type VarText = { [K in CallVar['kind']]: (v: Extract<CallVar, { kind: K }>) => Msg };

const VAR_TEXT: VarText = {
  town: (v) => siteName(v.id),
  site: (v) => siteName(v.id),
  money: (v) => money(v.amount),
  distance: (v) => distanceText(v.tiles),
  bearing: (v) => compass(v.rad),
  count: (v) => unitCount(v.unit, v.n),
  deal: dealText,
  prices: pricesText,
  aid: (v) => aidWords(v.fuel, v.supplies),
  haul: haulText,
  tip: tipText,
  line: (v) => lineText(v.line, {}),
  answer: () => { throw new Error('A rolled answer is never shown in a line'); },
};

function formatVar<K extends CallVar['kind']>(v: Extract<CallVar, { kind: K }>): Msg {
  return (VAR_TEXT[v.kind as K] as (x: typeof v) => Msg)(v);
}

// A radio line with the call values it names filled in. A value the line needs and the call lacks throws.
export function lineText(id: LineId, vars: CallVars): Msg {
  const key = lineKey(id);
  const params = Object.keys(schemaOf(key)).map((name) => {
    const v = vars[name];
    if (!v) throw new Error(`Line ${id} needs the call value ${name}`);
    return [name, formatVar(v)] as const;
  });
  return byId(key, Object.fromEntries(params));
}

function isTyping(): boolean {
  return document.activeElement?.matches('input, select, textarea') ?? false;
}

export function canCall(w: World, id: string): boolean {
  const v = w.vehicles.find((x) => x.id === id);
  return modeRules(w).radio && !!v?.brain && !isKnockedOut(v) && playerCanAct(w) && playerSees(w, v.pos);
}

export type DialogueHost = {
  world(): World;
  talk(next: World): void;
  inspected(): string | null;
  busy(): boolean;
  commit(next: World): void;
  log(next: World): void;
  playHorn(vehicleId: string, delayMs: number): void;
};

const HONK_REPLY_MS = 500;

class Horn {
  private queued = false;

  constructor(private readonly host: DialogueHost) {}

  sound(): void {
    if (!this.host.busy()) return this.send(false);
    if (this.queued) return;
    this.queued = true;
    this.host.playHorn(playerVehicle(this.host.world()).id, 0);
  }

  flush(): void {
    if (this.queued && playerCanAct(this.host.world())) this.send(true);
    this.queued = false;
  }

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
  private readonly root = panel('dialogue notice', topCenter());
  private readonly horn: Horn;
  private drawn = '';

  constructor(private readonly host: DialogueHost) {
    this.horn = new Horn(host);
    this.root.style.display = 'none';
    this.root.addEventListener('click', () => this.root.classList.add('qt-done'));
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  render(w: World): void {
    const call = w.player.call;
    this.root.style.display = call ? '' : 'none';
    if (!call) {
      this.drawn = '';
      return this.root.replaceChildren();
    }
    const offered = currentOptions(w);
    const key = JSON.stringify([call, offered.map((o) => o.line), language()]);
    if (key === this.drawn) return;
    this.drawn = key;
    const npc = vehicleById(w, call.with);
    this.root.style.borderLeftColor = `#${FACTION_COLORS[npc.faction].top.toString(16).padStart(6, '0')}`;
    this.root.classList.remove('qt-done');
    const options = offered.map((o, i) =>
      el('button', { class: 'dialogue-option', onclick: () => this.choose(i) }, t('call.option', { n: i + 1, line: lineText(o.line, call.vars) })),
    );
    const line = renderLine(`“${say(lineText(call.line.line, call.line.vars))}”`, [], 0).el;
    line.classList.add('dialogue-line');
    this.root.replaceChildren(el('div', { class: 'dialogue-speaker' }, t('call.speaker', { who: vehicleTitle(w, npc) })), line, el('div', { class: 'dialogue-options' }, ...options));
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

  flushHorn(): void {
    this.horn.flush();
  }

  private onBusyKey(e: KeyboardEvent): void {
    if (e.code === 'KeyH' && this.honk()) e.stopImmediatePropagation();
  }

  private honk(): boolean {
    if (!playerCanAct(this.host.world()) || !modeRules(this.host.world()).radio) return false;
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

  private callInspected(): boolean {
    const id = this.host.inspected();
    if (!id || !canCall(this.host.world(), id)) return false;
    this.host.talk(callVehicle(this.host.world(), id));
    return true;
  }
}
