import { DETECT } from '../data/detect';
import { BEACON } from '../data/tow';
import { RULES } from '../data/rules';
import { sunAt } from './sun';
import { TIME } from '../data/time';
import { describe, expect, it } from 'vitest';
import { addVehicle, editableTerrain, emptyWorld } from './testkit';
import { advanceDust, cloudsSeenBy, contactsOf, dustRange, markVehicle, scannerRange, soundRange } from './detect';
import { makePart } from './factory';
import { mountPart } from './inventory';
import { TERRAIN } from '../data/terrain';
import { PERK_NUMBERS, SKILL_EFFECTS } from '../data/skills';
import { dist } from './vec';
import { refreshVision, sightRadius } from './vision';
import { vehicleStats } from './stats';
import { corePart, mountedParts } from './grid';
import { playerVehicle } from './damage';
import type { World } from './types';

function raiseHill(w: ReturnType<typeof emptyWorld>): void {
  editableTerrain(w);
  const size = w.terrain.size;
  for (let i = 32; i <= 36; i++) for (let j = 28; j <= 32; j++) w.terrain.heights[j * (size + 1) + i] = 3;
}

describe('soundRange and dustRange', () => {
  it('a parked truck is silent and dustless', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = 0;
    expect(soundRange(w, v)).toBe(0);
    expect(dustRange(w, v)).toBe(0);
  });

  it('a limping truck raises no dust and is heard only a little past sight', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = RULES.limpSpeed;
    expect(dustRange(w, v)).toBe(0);
    const crawl = soundRange(w, v);
    v.speed = 6;
    expect(crawl).toBeLessThan(soundRange(w, v) / 2);
  });

  it('a road raises less dust than sand', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = 4;
    editableTerrain(w);
    const idx = Math.floor(v.pos.y) * w.terrain.size + Math.floor(v.pos.x);
    w.terrain.types[idx] = 'road';
    const onRoad = dustRange(w, v);
    w.terrain.types[idx] = 'sand';
    const onSand = dustRange(w, v);
    expect(onRoad).toBeLessThan(onSand);
  });

  it('own speed shortens hearing', () => {
    const w = emptyWorld({ x: 2, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;
    const observer = w.vehicles[0];
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 2, y: 30 });
    target.speed = 2;
    observer.speed = 2;
    target.pos = { x: 2 + soundRange(w, target) - DETECT.sound.ownPenalty, y: 30 };
    expect(target.pos.x).toBeLessThan(w.size);
    const movingContacts = contactsOf(w, observer, Infinity);
    expect(movingContacts.find((c) => c.vehicleId === target.id)).toBeUndefined();
    observer.speed = 0;
    const parkedContacts = contactsOf(w, observer, Infinity);
    expect(parkedContacts.find((c) => c.vehicleId === target.id)?.sources).toContain('sound');
  });

  it('night hides dust', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = 4;
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;
    expect(dustRange(w, v)).toBe(0);
  });
});

describe('hills and the scanner', () => {
  it('a hill blocks sight but not sound', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    raiseHill(w);
    refreshVision(w);
    const observer = w.vehicles[0];
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    target.speed = 4;
    const contacts = contactsOf(w, observer, Infinity);
    const contact = contacts.find((c) => c.vehicleId === target.id);
    expect(contact?.sources).toContain('sound');
    expect(contact?.sources).not.toContain('dust');
  });

  it('the scanner works through hills', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    raiseHill(w);
    refreshVision(w);
    const observer = w.vehicles[0];
    observer.items = observer.items.filter((it) => it.kind === 'good' || it.part.defId !== 'mg');
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    target.speed = 0.2;
    expect(scannerRange(w, observer)).toBe(0);
    const before = contactsOf(w, observer, Infinity);
    expect(before.find((c) => c.vehicleId === target.id)).toBeUndefined();
    if (!mountPart(w, observer, makePart(w, 'scanner', 0))) throw new Error('No free mount for the test scanner');
    target.speed = 4;
    expect(scannerRange(w, observer)).toBeGreaterThan(0);
    const after = contactsOf(w, observer, Infinity);
    expect(after.find((c) => c.vehicleId === target.id)?.sources).toContain('radio');
  });
});

describe('a worn scanner', () => {
  it('reaches less far', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const observer = w.vehicles[0];
    observer.items = observer.items.filter((it) => it.kind === 'good' || it.part.defId !== 'mg');
    const scanner = makePart(w, 'scanner', 0);
    if (!mountPart(w, observer, scanner)) throw new Error('No free mount for the test scanner');
    const fresh = scannerRange(w, observer);
    scanner.wear = 2;
    expect(scannerRange(w, observer)).toBeLessThan(fresh);
  });
});

describe('contact fuzz', () => {
  it('the circle always holds the true position', () => {
    const w = emptyWorld({ x: 20, y: 30 });
    const observer = w.vehicles[0];
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 31, y: 30 });
    target.speed = 3;
    for (let seed = 1; seed <= 50; seed++) {
      for (let turn = 1; turn <= 5; turn++) {
        w.seed = seed;
        w.turn = turn;
        const contacts = contactsOf(w, observer, Infinity);
        const contact = contacts.find((c) => c.vehicleId === target.id);
        if (!contact) continue;
        expect(dist(contact.center, target.pos)).toBeLessThanOrEqual(contact.radius);
      }
    }
  });
});

describe('dust clouds', () => {
  function dustyWorld() {
    const w = emptyWorld({ x: 10, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => sunAt(t))!;
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = 4;
    v.heading = 0;
    v.trail = [0, 1, 2, 3, 4].map((i) => ({ x: 36 + i, y: 30, heading: 0 }));
    editableTerrain(w).types.fill('sand');
    expect(dustRange(w, v)).toBeGreaterThan(40);
    return { w, v, observer: w.vehicles[0] };
  }

  it('a moving dusty truck raises a cloud behind it, and a parked one does not', () => {
    const { w, v } = dustyWorld();
    advanceDust(w);
    expect(w.dustClouds.filter((c) => c.source === v.id)).toHaveLength(1);
    expect(w.dustClouds[0].pos.x).toBeLessThan(v.pos.x);
    v.speed = 0;
    advanceDust(w);
    expect(w.dustClouds.filter((c) => c.source === v.id)).toHaveLength(1);
  });

  it('clouds drift back the way the truck came and are gone after their lifetime', () => {
    const { w, v } = dustyWorld();
    advanceDust(w);
    v.speed = 0;
    const start = { ...w.dustClouds[0].pos };
    advanceDust(w);
    expect(w.dustClouds[0].pos.x).toBeLessThan(start.x);
    for (let t = 0; t < DETECT.dust.lifetime; t++) advanceDust(w);
    expect(w.dustClouds).toHaveLength(0);
  });

  it('a fresh cloud stays hidden beyond sight until it has risen', () => {
    const { w, v, observer } = dustyWorld();
    advanceDust(w);
    v.speed = 0;
    expect(cloudsSeenBy(w, observer)).toHaveLength(0);
    for (let t = 0; t < DETECT.dust.riseTurns; t++) advanceDust(w);
    expect(cloudsSeenBy(w, observer)).toHaveLength(1);
  });

  it('a dust contact circle still holds the true position after the truck moves on', () => {
    const { w, v, observer } = dustyWorld();
    for (let t = 0; t <= DETECT.dust.riseTurns; t++) advanceDust(w);
    v.pos = { x: 48, y: 36 };
    v.speed = 0;
    const c = contactsOf(w, observer, Infinity).find((x) => x.vehicleId === v.id)!;
    expect(c.sources).toEqual(['dust']);
    expect(dist(c.center, v.pos)).toBeLessThanOrEqual(c.radius);
  });
});

describe('the emergency beacon', () => {
  function beaconing(observerX: number) {
    const w = emptyWorld({ x: 30, y: 30 });
    raiseHill(w);
    refreshVision(w);
    const me = w.vehicles[0];
    me.speed = 0;
    w.player.beacon = true;
    const observer = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: observerX, y: 30 });
    observer.speed = 0;
    return { w, me, observer };
  }

  it('gives any vehicle in range a tight contact through hills', () => {
    const { w, me, observer } = beaconing(40);
    const contact = contactsOf(w, observer, Infinity).find((c) => c.vehicleId === me.id);
    expect(contact?.sources).toEqual(['beacon']);
    expect(contact!.radius).toBe(BEACON.radius);
    expect(dist(contact!.center, me.pos)).toBeLessThan(BEACON.radius);
    expect(contact!.loudness).toBeNull();
  });

  it('reaches BEACON.range tiles and no farther', () => {
    const inRange = beaconing(30 + BEACON.range);
    expect(contactsOf(inRange.w, inRange.observer, Infinity).some((c) => c.vehicleId === inRange.me.id)).toBe(true);
    const outOfRange = beaconing(30 + BEACON.range + 1);
    expect(contactsOf(outOfRange.w, outOfRange.observer, Infinity).some((c) => c.vehicleId === outOfRange.me.id)).toBe(false);
  });

  it('gives nothing while off', () => {
    const { w, me, observer } = beaconing(40);
    w.player.beacon = false;
    expect(contactsOf(w, observer, Infinity).some((c) => c.vehicleId === me.id)).toBe(false);
  });

  it('merges with sound into one tight contact', () => {
    const { w, me, observer } = beaconing(40);
    w.player.fuel = 30;
    me.speed = 4;
    const contacts = contactsOf(w, observer, Infinity).filter((c) => c.vehicleId === me.id);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].sources).toEqual(['sound', 'beacon']);
    expect(contacts[0].radius).toBe(BEACON.radius);
  });

  it('leaves the player its own contacts', () => {
    const { w, me } = beaconing(40);
    expect(contactsOf(w, me, Infinity).some((c) => c.vehicleId === me.id)).toBe(false);
  });
});

describe('perception hearing and contact fix', () => {
  const night = () => Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;

  function pastHearing(listenerPos = { x: 2, y: 30 }) {
    const w = emptyWorld(listenerPos);
    w.turn = night();
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], listenerPos);
    target.speed = 2;
    target.pos = { x: listenerPos.x + soundRange(w, target) * 1.2, y: listenerPos.y };
    return { w, target };
  }

  it('the player hears farther at rank 5', () => {
    const { w, target } = pastHearing();
    const me = w.vehicles[0];
    expect(contactsOf(w, me, Infinity).find((c) => c.vehicleId === target.id)).toBeUndefined();
    w.player.ranks.perception = 5;
    expect(contactsOf(w, me, Infinity).find((c) => c.vehicleId === target.id)?.sources).toContain('sound');
  });

  it('an NPC listener does not hear farther from the player skill', () => {
    const { w, target } = pastHearing({ x: 2, y: 60 });
    const listener = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 2, y: 60 });
    listener.speed = 0;
    w.player.ranks.perception = 5;
    expect(contactsOf(w, listener, Infinity).find((c) => c.vehicleId === target.id)).toBeUndefined();
  });

  it('the player gets a tighter contact circle at rank 5', () => {
    const w = emptyWorld({ x: 20, y: 30 });
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 45, y: 30 });
    target.speed = 3;
    const radius = () => contactsOf(w, w.vehicles[0], Infinity).find((c) => c.vehicleId === target.id)!.radius;
    const base = radius();
    w.player.ranks.perception = 5;
    expect(radius()).toBeCloseTo(base * (1 - 5 * SKILL_EFFECTS.perception.contactFix));
  });

  it('an NPC observer keeps its contact circle', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const observer = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 20, y: 30 });
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 45, y: 30 });
    target.speed = 3;
    const radius = () => contactsOf(w, observer, Infinity).find((c) => c.vehicleId === target.id)!.radius;
    const base = radius();
    w.player.ranks.perception = 5;
    expect(radius()).toBe(base);
  });
});



describe('a stalled engine', () => {
  it('is silent while stalled and heard again after', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = 4;
    v.stalledUntil = w.turn;
    expect(soundRange(w, v)).toBe(0);
    v.stalledUntil = w.turn - 1;
    expect(soundRange(w, v)).toBeGreaterThan(0);
  });
});

describe('the cold running perk', () => {
  const night = () => Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;

  function coldWorld(share: number) {
    const w = emptyWorld({ x: 10, y: 30 });
    w.turn = night();
    const me = playerVehicle(w);
    me.speed = vehicleStats(w, me).maxSpeed * share;
    const listener = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 10, y: 30 });
    listener.speed = 0;
    const sight = sightRadius(w, listener);
    expect(soundRange(w, me)).toBeGreaterThan(sight + 2);
    listener.pos = { x: 10 + sight + 1, y: 30 };
    return { w, me, listener };
  }

  const heard = (w: World, listener: ReturnType<typeof addVehicle>, id: string) =>
    contactsOf(w, listener, Infinity).find((c) => c.vehicleId === id)?.sources.includes('sound') === true;

  it('keeps the player engine unheard past sight below half speed', () => {
    const { w, me, listener } = coldWorld(0.4);
    expect(heard(w, listener, me.id)).toBe(true);
    w.player.perks.push('coldRunning');
    expect(heard(w, listener, me.id)).toBe(false);
  });

  it('lets the engine be heard at half speed or more', () => {
    const { w, me, listener } = coldWorld(0.6);
    w.player.perks.push('coldRunning');
    expect(heard(w, listener, me.id)).toBe(true);
  });

  it('leaves NPC engines heard past sight', () => {
    const w = emptyWorld({ x: 10, y: 30 });
    w.turn = night();
    w.player.perks.push('coldRunning');
    const me = playerVehicle(w);
    me.speed = 0;
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 10, y: 30 });
    npc.speed = vehicleStats(w, npc).maxSpeed * 0.4;
    npc.pos = { x: 10 + sightRadius(w, me) + 1, y: 30 };
    expect(soundRange(w, npc)).toBeGreaterThan(sightRadius(w, me) + 2);
    expect(heard(w, me, npc.id)).toBe(true);
  });
});

describe('the dust screen perk', () => {
  function screenWorld(share: number, npc = false) {
    const w = emptyWorld({ x: 40, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => sunAt(t))!;
    editableTerrain(w).types.fill('sand');
    const v = npc ? addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 60 }) : playerVehicle(w);
    v.speed = vehicleStats(w, v).maxSpeed * share;
    v.trail = [0, 1, 2, 3, 4].map((i) => ({ x: v.pos.x - 4 + i, y: v.pos.y, heading: 0 }));
    return { w, v };
  }

  it('makes the player cloud a screen at top speed', () => {
    const { w, v } = screenWorld(PERK_NUMBERS.dustScreen.topShare);
    w.player.perks.push('dustScreen');
    advanceDust(w);
    expect(w.dustClouds.find((c) => c.source === v.id)?.screen).toBe(true);
  });

  it('raises a plain cloud below top speed', () => {
    const { w, v } = screenWorld(PERK_NUMBERS.dustScreen.topShare * 0.8);
    w.player.perks.push('dustScreen');
    advanceDust(w);
    const cloud = w.dustClouds.find((c) => c.source === v.id);
    expect(cloud).toBeDefined();
    expect(cloud?.screen).toBeUndefined();
  });

  it('raises a plain cloud without the perk', () => {
    const { w, v } = screenWorld(1);
    advanceDust(w);
    expect(w.dustClouds.find((c) => c.source === v.id)?.screen).toBeUndefined();
  });

  it('leaves NPC clouds plain', () => {
    const { w, v } = screenWorld(1, true);
    w.player.perks.push('dustScreen');
    advanceDust(w);
    expect(w.dustClouds.find((c) => c.source === v.id)?.screen).toBeUndefined();
  });
});

describe('the spotter perk', () => {
  function spotterWorld() {
    const w = emptyWorld({ x: 30, y: 30 });
    const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 35, y: 30 });
    target.speed = 0;
    refreshVision(w);
    expect(scannerRange(w, playerVehicle(w))).toBe(0);
    return { w, target };
  }

  function driveOff(w: World, id: string): void {
    w.vehicles.find((v) => v.id === id)!.pos = { x: 90, y: 90 };
    refreshVision(w);
  }

  it('marks a seen truck for a day', () => {
    const { w, target } = spotterWorld();
    w.player.perks.push('spotter');
    const after = markVehicle(w, target.id);
    expect(after.player.marked).toEqual([{ vehicleId: target.id, until: w.turn + PERK_NUMBERS.spotter.turns }]);
    expect(w.player.marked).toEqual([]);
  });

  it('replaces an older mark on the same truck', () => {
    const { w, target } = spotterWorld();
    w.player.perks.push('spotter');
    const first = markVehicle(w, target.id);
    first.turn += 5;
    const second = markVehicle(first, target.id);
    expect(second.player.marked).toEqual([{ vehicleId: target.id, until: first.turn + PERK_NUMBERS.spotter.turns }]);
  });

  it('refuses to mark without the perk', () => {
    const { w, target } = spotterWorld();
    expect(() => markVehicle(w, target.id)).toThrow('spotter');
  });

  it('refuses to mark an unseen truck', () => {
    const { w, target } = spotterWorld();
    w.player.perks.push('spotter');
    driveOff(w, target.id);
    expect(() => markVehicle(w, target.id)).toThrow('does not see');
  });

  it('refuses to mark an unknown truck', () => {
    const { w } = spotterWorld();
    w.player.perks.push('spotter');
    expect(() => markVehicle(w, 'ghost')).toThrow('ghost');
  });

  it('tracks a marked truck out of sight with a scanner-tight circle', () => {
    const { w, target } = spotterWorld();
    w.player.perks.push('spotter');
    const marked = markVehicle(w, target.id);
    driveOff(marked, target.id);
    const contact = marked.player.contacts.find((c) => c.vehicleId === target.id);
    const d = dist(playerVehicle(marked).pos, { x: 90, y: 90 });
    expect(contact?.sources).toEqual(['mark']);
    expect(contact?.radius).toBeCloseTo(DETECT.fuzz.base + DETECT.fuzz.radioPerTile * d);
  });

  it('gives no contact on an unmarked truck out of sight', () => {
    const { w, target } = spotterWorld();
    driveOff(w, target.id);
    expect(w.player.contacts.find((c) => c.vehicleId === target.id)).toBeUndefined();
  });

  it('adds the mark to a contact the truck already gives', () => {
    const { w, target } = spotterWorld();
    w.player.perks.push('spotter');
    const marked = markVehicle(w, target.id);
    const v = marked.vehicles.find((x) => x.id === target.id)!;
    v.pos = { x: 30 + sightRadius(marked, playerVehicle(marked)) + 2, y: 30 };
    v.speed = 4;
    refreshVision(marked);
    expect(marked.player.contacts.find((c) => c.vehicleId === target.id)?.sources).toEqual(['sound', 'mark']);
  });

  it('drops the mark after its last turn', () => {
    const { w, target } = spotterWorld();
    w.player.perks.push('spotter');
    const marked = markVehicle(w, target.id);
    marked.turn += PERK_NUMBERS.spotter.turns + 1;
    driveOff(marked, target.id);
    expect(marked.player.marked).toEqual([]);
    expect(marked.player.contacts.find((c) => c.vehicleId === target.id)).toBeUndefined();
  });

  it('gives an NPC observer no mark contacts', () => {
    const { w, target } = spotterWorld();
    w.player.perks.push('spotter');
    const marked = markVehicle(w, target.id);
    const npc = addVehicle(marked, 'traders', 'scout', ['stockEngine'], { x: 30, y: 30 });
    driveOff(marked, target.id);
    expect(contactsOf(marked, npc, Infinity).find((c) => c.vehicleId === target.id)).toBeUndefined();
  });
});

describe('a stranded truck', () => {
  const day = () => Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => sunAt(t))!;

  function crawling() {
    const w = emptyWorld({ x: 5, y: 30 });
    w.turn = day();
    editableTerrain(w).types.fill('sand');
    const me = w.vehicles[0];
    me.speed = 0;
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    v.speed = RULES.limpSpeed;
    v.heading = 0;
    v.trail = [0, 1, 2, 3, 4].map((i) => ({ x: 36 + i, y: 30, heading: 0 }));
    return { w, me, v };
  }

  const strandings: [string, (w: World, v: ReturnType<typeof addVehicle>) => void][] = [
    ['an empty tank', (_w, v) => { v.resources!.fuel = 0; }],
    ['a broken transmission', (_w, v) => { corePart(v, 'transmission').hp = 0; }],
    ['a broken engine', (_w, v) => { mountedParts(v, 'engine')[0].hp = 0; }],
  ];

  it('is heard at a crawl while healthy', () => {
    const { w, v } = crawling();
    expect(soundRange(w, v)).toBeGreaterThan(0);
  });

  for (const [name, strand] of strandings) {
    it(`makes no sound or dust with ${name}`, () => {
      const { w, v } = crawling();
      strand(w, v);
      v.speed = 4;
      expect(soundRange(w, v)).toBe(0);
      expect(dustRange(w, v)).toBe(0);
    });
  }

  it('raises no dust for a skilled player crawling past limp speed', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    w.turn = day();
    editableTerrain(w).types.fill('sand');
    const me = w.vehicles[0];
    corePart(me, 'transmission').hp = 0;
    w.player.ranks.driving = 5;
    me.speed = vehicleStats(w, me).maxSpeed;
    me.trail = [{ x: 39, y: 30, heading: 0 }, { x: 40, y: 30, heading: 0 }];
    expect(me.speed).toBeGreaterThan(RULES.limpSpeed);
    advanceDust(w);
    expect(w.dustClouds.filter((c) => c.source === me.id)).toHaveLength(0);
  });

  it('drops its sound contact and stops raising dust once it strands, and is heard again once refuelled', () => {
    const { w, me, v } = crawling();
    v.speed = 4;
    const listener = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 75, y: 30 });
    listener.speed = 0;
    refreshVision(w);
    expect(w.player.contacts.find((c) => c.vehicleId === v.id)?.sources).toContain('sound');
    expect(contactsOf(w, listener, Infinity).find((c) => c.vehicleId === v.id)?.sources).toContain('sound');
    advanceDust(w);
    expect(w.dustClouds.filter((c) => c.source === v.id)).toHaveLength(1);
    v.resources!.fuel = 0;
    refreshVision(w);
    expect(w.player.contacts.find((c) => c.vehicleId === v.id)?.sources ?? []).not.toContain('sound');
    expect(contactsOf(w, listener, Infinity).find((c) => c.vehicleId === v.id)?.sources ?? []).not.toContain('sound');
    advanceDust(w);
    const clouds = w.dustClouds.filter((c) => c.source === v.id);
    expect(clouds).toHaveLength(1);
    expect(clouds[0].age).toBe(1);
    expect(me.speed).toBe(0);
    v.resources!.fuel = 10;
    expect(contactsOf(w, listener, Infinity).find((c) => c.vehicleId === v.id)?.sources).toContain('sound');
  });

  it('hides the player from an NPC as it hides an NPC from the player', () => {
    const w = emptyWorld({ x: 5, y: 30 });
    w.turn = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;
    const me = w.vehicles[0];
    me.speed = 4;
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    npc.speed = 4;
    const heard = (from: typeof me, of: typeof me) => contactsOf(w, from, Infinity).find((c) => c.vehicleId === of.id)?.sources ?? [];
    me.speed = 0;
    expect(heard(me, npc)).toContain('sound');
    me.speed = 4;
    npc.speed = 0;
    expect(heard(npc, me)).toContain('sound');
    w.player.fuel = 0;
    expect(heard(npc, me)).not.toContain('sound');
    npc.speed = 4;
    me.speed = 0;
    npc.resources!.fuel = 0;
    expect(heard(me, npc)).not.toContain('sound');
  });

  it('still gives a beacon contact and is still found by a scanner', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    raiseHill(w);
    refreshVision(w);
    const me = w.vehicles[0];
    me.speed = RULES.limpSpeed;
    w.player.fuel = 0;
    w.player.beacon = true;
    const observer = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    observer.speed = 0;
    expect(contactsOf(w, observer, Infinity).find((c) => c.vehicleId === me.id)?.sources).toEqual(['beacon']);
    observer.resources!.fuel = 0;
    observer.speed = 4;
    me.speed = 0;
    w.player.fuel = 10;
    me.items = me.items.filter((it) => it.kind === 'good' || it.part.defId !== 'mg');
    if (!mountPart(w, me, makePart(w, 'scanner', 0))) throw new Error('No free mount for the test scanner');
    expect(contactsOf(w, me, Infinity).find((c) => c.vehicleId === observer.id)?.sources).toEqual(['radio']);
  });
});
