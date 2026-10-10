// Waste Of Time Radio. RadioStation decides what J.J. broadcasts from the worlds the HUD hears. It reads world
// state and events and never writes them, so the radio changes no rule. RadioPanel streams each broadcast onto a
// pager screen and holds the sound knobs on its faceplate. Lines and pacing live in src/data/radio.ts.

import { DIRECTIONS, RADIO, RADIO_HOURS, RADIO_VARIANTS, type Direction, type RadioTopic } from '../data/radio';
import { atlasOf, atlasSites } from '../sim/atlas';
import { TIME } from '../data/time';
import type { Contract } from '../sim/market';
import { siteOf } from '../sim/market';
import { robbing } from '../sim/states';
import { clockOf } from '../sim/sun';
import type { GameEvent, Vehicle, WeatherEvent, World } from '../sim/types';
import { dist, type Vec } from '../sim/vec';
import { say } from '../text/language';
import { byId, t, type Msg } from '../text/msg';
import { goodLower, partName, siteName, templateName } from '../text/names';
import { el, panel, rightDock } from './dom';

// variant: which of the topic's lines J.J. says. text: the line with its slots filled.
export type Broadcast = { topic: RadioTopic; variant: number; text: Msg; turn: number; rank: 'news' | 'time' | 'filler' };
type Slots = Record<string, Msg>;
// Where news happened: key tells one place from another for the cooldown, words name it on air.
type Place = { key: string; words: Msg };

const RANKS: Broadcast['rank'][] = ['news', 'time', 'filler'];

const WEATHER_TOPICS: Record<WeatherEvent['kind'], Partial<Record<'started' | 'ended', RadioTopic>>> = {
  heatwave: { started: 'heatwaveStart', ended: 'heatwaveEnd' },
  overcast: { started: 'overcastStart' },
  storm: { started: 'stormStart', ended: 'stormEnd' },
};

const CLOCK_CALLS: { topic: RadioTopic; hour: number }[] = [
  { topic: 'midnight', hour: RADIO_HOURS.midnight },
  { topic: 'dawn', hour: TIME.sunrise },
  { topic: 'noon', hour: RADIO_HOURS.noon },
  { topic: 'dusk', hour: TIME.sunset },
];

// A line with its slots filled. The resolver throws on a missing or unknown slot, which is a content bug.
export function radioLine(topic: RadioTopic, variant: number, slots: Slots): Msg {
  return byId(`radio.${topic}.${variant}`, slots);
}

export class RadioStation {
  private turn: number | null = null;
  private seed: number | null = null;
  private board = new Set<string>();
  private queue: Broadcast[] = [];
  private lastSent: number | null = null; // turn of the last broadcast sent
  private nextAir = 0; // randomized earliest turn for the next broadcast
  private lastAir = 0; // turn of the last broadcast queued or sent, for the idle filler
  private placeHeard = new Map<string, number>(); // raid place key -> turn it was last reported
  private lastVariant = new Map<RadioTopic, number>();

  constructor(private random: () => number) {}

  get queued(): number {
    return this.queue.length;
  }

  hear(world: World): void {
    const prev = this.turn;
    if (prev === null || this.retuned(world, prev)) {
      this.tuneIn(world);
      return;
    }
    this.turn = world.turn;
    for (const e of world.events) this.news(world, e);
    this.contractNews(world);
    this.timeCall(prev, world.turn);
    if (this.queue.length === 0 && world.turn - this.lastAir >= RADIO.idleTurns) this.push('wisdom', {}, 'filler');
  }

  private retuned(world: World, prev: number): boolean {
    return world.seed !== this.seed || world.turn < prev;
  }

  next(): Broadcast | null {
    if (this.turn === null) return null;
    const now = this.turn;
    if (now < this.nextAir) return null;
    this.queue = this.queue.filter((b) => b.rank === 'filler' || now - b.turn <= RADIO.staleTurns);
    for (const rank of RANKS) {
      const newest = this.queue.filter((b) => b.rank === rank).at(-1);
      if (!newest) continue;
      this.queue.splice(this.queue.indexOf(newest), 1);
      this.lastSent = now;
      this.lastAir = now;
      this.nextAir = now + RADIO.minGapTurns + Math.floor(this.random() * (RADIO.gapJitterTurns + 1));
      return newest;
    }
    return null;
  }

  private tuneIn(world: World): void {
    this.turn = world.turn;
    this.seed = world.seed;
    this.board = boardIds(world);
    this.queue = [];
    this.lastSent = null;
    this.nextAir = world.turn;
    this.placeHeard.clear();
    this.push('ident', {}, 'time');
  }

  private news(world: World, e: GameEvent): void {
    if (e.t === 'weather') this.weatherNews(world, e);
    if (e.t === 'hostile' && robbing(world, e.vehicle, e.against)) this.raidNews(world, 'raid', e.vehicle, e.against);
    if (e.t === 'npcKnockout') this.raidNews(world, 'raidKnockout', e.by, e.vehicle);
  }

  private weatherNews(world: World, e: Extract<GameEvent, { t: 'weather' }>): void {
    const w = e.event;
    const topic = WEATHER_TOPICS[w.kind][e.outcome];
    if (!topic) return;
    this.push(topic, w.kind === 'storm' ? { place: placeOf(world, w.pos).words, heading: t(`radio.heading.${compass(w.vel)}`) } : {}, 'news');
  }

  private raidNews(world: World, topic: RadioTopic, attackerId: string, victimId: string): void {
    const place = raidPlace(world, attackerId, victimId);
    if (place === null || this.recentlyHeard(place.key, world.turn)) return;
    this.placeHeard.set(place.key, world.turn);
    this.push(topic, { place: place.words }, 'news');
  }

  private recentlyHeard(place: string, turn: number): boolean {
    const heard = this.placeHeard.get(place);
    return heard !== undefined && turn - heard < RADIO.placeCooldownTurns;
  }

  private contractNews(world: World): void {
    const old = this.board;
    const fresh: Contract[] = [];
    this.board = new Set();
    for (const shop of Object.values(world.shops)) {
      for (const c of shop.contracts) {
        this.board.add(c.id);
        if (!old.has(c.id)) fresh.push(c);
      }
    }
    if (fresh.length === 0) return;
    const found = (id: string) => world.player.discovered.includes(id);
    const known = fresh.filter((c) => found(c.shop) && (c.kind !== 'haul' || found(c.to)));
    const best = known.sort((a, b) => b.reward - a.reward)[0];
    if (best) this.push(best.kind, contractVars(best), 'news');
  }

  private timeCall(prevTurn: number, turn: number): void {
    const from = hoursOf(prevTurn);
    const to = hoursOf(turn);
    if (Math.floor(from) === Math.floor(to)) return;
    const latest = clockCalls(from, to).filter((c) => c.at > from && c.at <= to).at(-1);
    if (latest && this.random() < RADIO.clockChance) this.push(latest.topic, {}, 'time');
  }

  private push(topic: RadioTopic, slots: Slots, rank: Broadcast['rank']): void {
    const variant = this.pick(topic);
    this.queue.push({ topic, variant, text: radioLine(topic, variant, slots), turn: this.turn!, rank });
    this.lastAir = this.turn!;
    while (this.queue.length > RADIO.queueCap) this.queue.splice(this.queue.indexOf(dropFirst(this.queue)), 1);
  }

  // A random variant, never the same one twice in a row.
  private pick(topic: RadioTopic): number {
    const all = Array.from({ length: RADIO_VARIANTS[topic] }, (_, i) => i);
    const options = all.length > 1 ? all.filter((i) => i !== this.lastVariant.get(topic)) : all;
    const variant = options[Math.floor(this.random() * options.length)];
    this.lastVariant.set(topic, variant);
    return variant;
  }
}

function clockCalls(from: number, to: number): { topic: RadioTopic; at: number }[] {
  const calls: { topic: RadioTopic; at: number }[] = [];
  for (let day = Math.floor(from / 24); day <= Math.floor(to / 24); day++) {
    for (const call of CLOCK_CALLS) calls.push({ topic: call.topic, at: day * 24 + call.hour });
  }
  return calls;
}

// Where a raider robbed or knocked out another driver. Null for anything touching the player or not by raiders.
function raidPlace(world: World, attackerId: string, victimId: string): Place | null {
  if ([attackerId, victimId].includes(world.player.vehicleId)) return null;
  const victim = vehicleIn(world, victimId);
  if (!victim || vehicleIn(world, attackerId)?.faction !== 'raiders') return null;
  return placeOf(world, victim.pos);
}

function dropFirst(queue: Broadcast[]): Broadcast {
  for (const rank of [...RANKS].reverse()) {
    const oldest = queue.find((b) => b.rank === rank);
    if (oldest) return oldest;
  }
  throw new Error('Radio queue is empty');
}

function boardIds(world: World): Set<string> {
  return new Set(Object.values(world.shops).flatMap((s) => s.contracts.map((c) => c.id)));
}

function contractVars(c: Contract): Slots {
  const shop = siteName(siteOf(c.shop).id);
  if (c.kind === 'haul') return { shop, good: goodLower(c.good), to: siteName(siteOf(c.to).id) };
  if (c.kind === 'fetch') return { shop, part: partName(c.defId) };
  return { shop, target: templateName(c.template) };
}

function vehicleIn(world: World, id: string): Vehicle | undefined {
  return world.vehicles.find((v) => v.id === id);
}

function hoursOf(turn: number): number {
  const { day, hour } = clockOf(turn);
  return (day - 1) * 24 + hour;
}

// "near X" for the nearest found site within reach, else the basin direction from the map's center.
// Unfound sites stay unnamed, so the radio never does the Rumor mill perk's work.
function placeOf(world: World, pos: Vec): Place {
  const nearest = atlasSites(atlasOf(world.terrain)).reduce((a, b) => (dist(b.pos, pos) < dist(a.pos, pos) ? b : a));
  if (dist(nearest.pos, pos) <= RADIO.nearTiles && world.player.discovered.includes(nearest.id)) {
    return { key: nearest.id, words: t('radio.near', { site: siteName(nearest.id) }) };
  }
  const center = world.size / 2;
  const basin = compass({ x: pos.x - center, y: pos.y - center });
  return { key: basin, words: t(`radio.basin.${basin}`) };
}

// One of the eight directions clockwise from east for a direction on the map, where north is -y.
function compass(v: Vec): Direction {
  const turns = Math.atan2(v.y, v.x) / (2 * Math.PI);
  return DIRECTIONS[(Math.round(turns * 8) + 8) % 8];
}

export function revealed(text: string, elapsedMs: number, charsPerSecond: number): string {
  return text.slice(0, Math.max(0, Math.floor((elapsedMs / 1000) * charsPerSecond)));
}

export class RadioPanel {
  readonly root = panel('radio dock-panel', rightDock());
  readonly faceplate = el('div', { class: 'radio-faceplate' });
  readonly keys = el('div', { class: 'radio-keys' });
  private text = el('div', { class: 'radio-text', 'aria-live': 'polite', 'aria-busy': 'false' });
  private lcd: HTMLElement;
  private streaming: { text: string; start: number } | null = null;
  // The broadcast on screen, so a language switch can show it again in the new words.
  private shown: Msg | null = null;

  constructor(private station: RadioStation) {
    const band = el('div', { class: 'radio-band' }, el('span', {}, t('radio.band')), el('span', {}, t('radio.frequency')));
    const ghost = el('div', { class: 'radio-ghost', 'aria-hidden': 'true' }, t('radio.ghost', { blocks: '\u2588'.repeat(3 * 30) }));
    this.lcd = el('div', { class: 'radio-lcd' }, ghost, this.text);
    this.root.append(this.keys, el('div', { class: 'radio-screen' }, band, this.lcd), this.faceplate);
  }

  private write(text: string): void {
    this.text.replaceChildren(text);
    this.lcd.scrollTop = this.lcd.scrollHeight;
  }

  hear(world: World): void {
    this.station.hear(world);
    if (!this.streaming) this.play();
  }

  private play(): void {
    const b = this.station.next();
    if (!b) return;
    this.shown = b.text;
    this.streaming = { text: say(b.text), start: performance.now() };
    this.write('');
    this.text.setAttribute('aria-busy', 'true');
    this.text.classList.add('streaming');
    requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    const s = this.streaming;
    if (!s) return;
    const shown = revealed(s.text, now - s.start, RADIO.charsPerSecond);
    // Several frames pass per character, so the screen is written only when one appears.
    if (shown.length !== this.text.textContent?.length) this.write(shown);
    if (shown.length < s.text.length) {
      requestAnimationFrame(this.tick);
      return;
    }
    this.streaming = null;
    this.text.setAttribute('aria-busy', 'false');
    this.text.classList.remove('streaming');
    this.play();
  };

  // A language switch shows the broadcast on screen whole in the new words. A stream in progress ends with it.
  relocalize(): void {
    if (!this.shown) return;
    this.streaming = null;
    this.text.setAttribute('aria-busy', 'false');
    this.text.classList.remove('streaming');
    this.write(say(this.shown));
  }
}
