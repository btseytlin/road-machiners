// Waste Of Time Radio. RadioStation decides what J.J. broadcasts from the worlds the HUD hears. It reads world
// state and events and never writes them, so the radio changes no rule. RadioPanel streams each broadcast onto a
// pager screen and holds the sound knobs on its faceplate. Lines and pacing live in src/data/radio.ts.

import { GOODS } from '../data/goods';
import { partDef } from '../data/parts';
import { BASIN_DIRECTIONS, HEADINGS, RADIO, RADIO_HOURS, RADIO_LINES, type RadioTopic } from '../data/radio';
import { REGION } from '../data/region';
import { TIME } from '../data/time';
import type { Contract } from '../sim/market';
import { siteOf } from '../sim/market';
import { robbing } from '../sim/states';
import { clockOf } from '../sim/sun';
import type { GameEvent, Vehicle, WeatherEvent, World } from '../sim/types';
import { dist, type Vec } from '../sim/vec';
import { el, panel, rightDock } from './dom';

export type Broadcast = { topic: RadioTopic; text: string; turn: number; rank: 'news' | 'time' | 'filler' };

const RANKS: Broadcast['rank'][] = ['news', 'time', 'filler'];
const SITES = [...REGION.towns, ...REGION.locations];

const WEATHER_TOPICS: Record<WeatherEvent['kind'], Partial<Record<'started' | 'ended', RadioTopic>>> = {
  heatwave: { started: 'heatwaveStart', ended: 'heatwaveEnd' },
  overcast: { started: 'overcastStart' },
  storm: { started: 'stormStart', ended: 'stormEnd' },
};

// The clock calls in the order they come after midnight.
const CLOCK_CALLS: { topic: RadioTopic; hour: number }[] = [
  { topic: 'midnight', hour: RADIO_HOURS.midnight },
  { topic: 'dawn', hour: TIME.sunrise },
  { topic: 'noon', hour: RADIO_HOURS.noon },
  { topic: 'dusk', hour: TIME.sunset },
];

// Fills a line's {slots}. An unknown slot is a content bug, so it throws.
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, slot: string) => {
    const value = vars[slot];
    if (value === undefined) throw new Error(`Radio line has no value for {${slot}}: ${template}`);
    return value;
  });
}

export class RadioStation {
  private turn: number | null = null;
  private seed: number | null = null;
  private board = new Set<string>();
  private queue: Broadcast[] = [];
  private lastSent: number | null = null; // turn of the last broadcast sent
  private nextAir = 0; // randomized earliest turn for the next broadcast
  private lastAir = 0; // turn of the last broadcast queued or sent, for the idle filler
  private placeHeard = new Map<string, number>(); // raid place word -> turn it was last reported
  private lastText = new Map<RadioTopic, string>();

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

  // A load or a new game: the seed changed or the clock went back.
  private retuned(world: World, prev: number): boolean {
    return world.seed !== this.seed || world.turn < prev;
  }

  // The best broadcast that is not stale, or null while the gap since the last one lasts.
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

  // A new game, a load or a first world: everything on the boards counts as old, and J.J. says hello.
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
    this.push(topic, w.kind === 'storm' ? { place: placeWord(world, w.pos), heading: compass(w.vel, HEADINGS) } : {}, 'news');
  }

  // A raider's robbery or knockout of another driver, never one touching the player.
  private raidNews(world: World, topic: RadioTopic, attackerId: string, victimId: string): void {
    const place = raidPlace(world, attackerId, victimId);
    if (place === null || this.recentlyHeard(place, world.turn)) return;
    this.placeHeard.set(place, world.turn);
    this.push(topic, { place }, 'news');
  }

  private recentlyHeard(place: string, turn: number): boolean {
    const heard = this.placeHeard.get(place);
    return heard !== undefined && turn - heard < RADIO.placeCooldownTurns;
  }

  // The best paid contract posted since the last world, on a found board to a found place.
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

  // The latest clock call crossed between two heard worlds.
  private timeCall(prevTurn: number, turn: number): void {
    const from = hoursOf(prevTurn);
    const to = hoursOf(turn);
    // Calls fall on whole hours, so none lies between two times in the same hour.
    if (Math.floor(from) === Math.floor(to)) return;
    const latest = clockCalls(from, to).filter((c) => c.at > from && c.at <= to).at(-1);
    if (latest && this.random() < RADIO.clockChance) this.push(latest.topic, {}, 'time');
  }

  private push(topic: RadioTopic, vars: Record<string, string>, rank: Broadcast['rank']): void {
    this.queue.push({ topic, text: fill(this.pick(topic), vars), turn: this.turn!, rank });
    this.lastAir = this.turn!;
    while (this.queue.length > RADIO.queueCap) this.queue.splice(this.queue.indexOf(dropFirst(this.queue)), 1);
  }

  // A random variant, never the same one twice in a row.
  private pick(topic: RadioTopic): string {
    const all = RADIO_LINES[topic];
    const options = all.length > 1 ? all.filter((t) => t !== this.lastText.get(topic)) : all;
    const text = options[Math.floor(this.random() * options.length)];
    this.lastText.set(topic, text);
    return text;
  }
}

// Every clock call on the days from one hour count to another, in order.
function clockCalls(from: number, to: number): { topic: RadioTopic; at: number }[] {
  const calls: { topic: RadioTopic; at: number }[] = [];
  for (let day = Math.floor(from / 24); day <= Math.floor(to / 24); day++) {
    for (const call of CLOCK_CALLS) calls.push({ topic: call.topic, at: day * 24 + call.hour });
  }
  return calls;
}

// Where a raider robbed or knocked out another driver. Null for anything touching the player or not by raiders.
function raidPlace(world: World, attackerId: string, victimId: string): string | null {
  if ([attackerId, victimId].includes(world.player.vehicleId)) return null;
  const victim = vehicleIn(world, victimId);
  if (!victim || vehicleIn(world, attackerId)?.faction !== 'raiders') return null;
  return placeWord(world, victim.pos);
}

// The queued broadcast to drop when full: the oldest of the lowest rank.
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

function contractVars(c: Contract): Record<string, string> {
  const shop = siteOf(c.shop).name;
  if (c.kind === 'haul') return { shop, good: GOODS[c.good].name.toLowerCase(), to: siteOf(c.to).name };
  if (c.kind === 'fetch') return { shop, part: partDef(c.defId).name };
  return { shop, target: c.targetName };
}

// A vehicle can leave the world in the step that reported it. It then has no place to report.
function vehicleIn(world: World, id: string): Vehicle | undefined {
  return world.vehicles.find((v) => v.id === id);
}

// Hours since the start of day 1.
function hoursOf(turn: number): number {
  const { day, hour } = clockOf(turn);
  return (day - 1) * 24 + hour;
}

// "near X" for the nearest found site within reach, else the basin direction from the map's center.
// Unfound sites stay unnamed, so the radio never does the Rumor mill perk's work.
function placeWord(world: World, pos: Vec): string {
  const nearest = SITES.reduce((a, b) => (dist(b.pos, pos) < dist(a.pos, pos) ? b : a));
  if (dist(nearest.pos, pos) <= RADIO.nearTiles && world.player.discovered.includes(nearest.id)) return `near ${nearest.name}`;
  const center = REGION.size / 2;
  return compass({ x: pos.x - center, y: pos.y - center }, BASIN_DIRECTIONS);
}

// One of eight words clockwise from east for a direction on the map, where north is -y.
function compass<T extends string>(v: Vec, words: readonly T[]): T {
  const turns = Math.atan2(v.y, v.x) / (2 * Math.PI);
  return words[(Math.round(turns * 8) + 8) % 8];
}

// The start of a broadcast shown after some real time of typing.
export function revealed(text: string, elapsedMs: number, charsPerSecond: number): string {
  return text.slice(0, Math.max(0, Math.floor((elapsedMs / 1000) * charsPerSecond)));
}

// The car radio above the log. It only streams and draws. The station picks every line.
export class RadioPanel {
  readonly root = panel('radio', rightDock());
  readonly faceplate = el('div', { class: 'radio-faceplate' });
  // Screen readers wait for aria-busy to clear, so they read a broadcast once, whole.
  private text = el('div', { class: 'radio-text', 'aria-live': 'polite', 'aria-busy': 'false' });
  private streaming: { text: string; start: number } | null = null;

  constructor(private station: RadioStation) {
    const band = el('div', { class: 'radio-band' }, el('span', {}, 'WOT RADIO'), el('span', {}, 'FM 66.6'));
    const ghost = el('div', { class: 'radio-ghost', 'aria-hidden': 'true' }, '\u2588'.repeat(3 * 30));
    this.root.append(el('div', { class: 'radio-screen' }, band, el('div', { class: 'radio-lcd' }, ghost, this.text)), this.faceplate);
  }

  hear(world: World): void {
    this.station.hear(world);
    if (!this.streaming) this.play();
  }

  // Starts the next broadcast. A finished one stays on screen until a new one replaces it.
  private play(): void {
    const b = this.station.next();
    if (!b) return;
    this.streaming = { text: b.text, start: performance.now() };
    this.text.textContent = '';
    this.text.setAttribute('aria-busy', 'true');
    this.text.classList.add('streaming');
    requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    const s = this.streaming;
    if (!s) return;
    const shown = revealed(s.text, now - s.start, RADIO.charsPerSecond);
    // Several frames pass per character, so the screen is written only when one appears.
    if (shown.length !== this.text.textContent?.length) this.text.textContent = shown;
    if (shown.length < s.text.length) {
      requestAnimationFrame(this.tick);
      return;
    }
    this.streaming = null;
    this.text.setAttribute('aria-busy', 'false');
    this.text.classList.remove('streaming');
    this.play();
  };
}
