import { describe, expect, it } from 'vitest';
import { CONTRACTS } from '../data/market';
import { LOCAL_TOPICS } from '../data/locals';
import { REGION } from '../data/region';
import { WAGON_SEVEN } from '../data/salvage';
import { askLocal, localsAt, localTopics, localWork, takeLocalWork, workLine } from './locals';
import { acceptContract, type Contract } from './market';
import { sitePads } from './sites';
import { emptyWorld } from './testkit';
import type { World } from './types';

const site = (id: string) => [...REGION.towns, ...REGION.locations].find((s) => s.id === id)!;

function parkedAt(town: string): World {
  return emptyWorld(sitePads(site(town))[0]);
}

const topicIds = (w: World, local: Parameters<typeof localTopics>[1]) => localTopics(w, local).map((t) => t.id);

// The world as talk may not touch it: everything but the journal and the events.
function untouched(w: World): unknown {
  return { ...w, player: { ...w.player, notes: null }, events: null };
}

const haul = (id: string, reward: number): Contract => ({ id, shop: 'bowl', kind: 'haul', good: 'salt', units: 1, to: 'nose', reward, deadline: 500, window: 500, rush: false, tier: 1 });

describe('settlement locals', () => {
  it('lists three locals at each town and none at a stall', () => {
    expect(localsAt('bowl').map((l) => l.id)).toEqual(['ruben', 'hattie', 'dag']);
    expect(localsAt('nose').map((l) => l.id)).toEqual(['kovac', 'lena', 'ibo']);
    expect(localsAt('salvage-yard')).toEqual([]);
  });

  it('opens a topic only once its fact holds', () => {
    const w = parkedAt('nose');
    expect(topicIds(w, 'ibo')).not.toContain('ibo.burntConvoy');
    expect(topicIds(w, 'kovac')).not.toContain('kovac.wagon');
    expect(topicIds(w, 'kovac')).not.toContain('kovac.wagonFound');

    w.player.discovered.push('burnt-convoy');
    w.player.notes.push({ id: 'wagonBowl', turn: 0 });
    w.player.scavenged.push(WAGON_SEVEN);

    expect(topicIds(w, 'ibo')).toContain('ibo.burntConvoy');
    expect(topicIds(w, 'kovac')).toEqual(['kovac.place', 'kovac.rulers', 'kovac.work', 'kovac.wagon', 'kovac.wagonFound']);
  });

  it('opens the Fallen Sun question once the crater is found', () => {
    const w = parkedAt('bowl');
    expect(topicIds(w, 'ruben')).not.toContain('ruben.fallenSunReal');
    w.player.discovered.push('fallen-sun');
    expect(topicIds(w, 'ruben')).toContain('ruben.fallenSunReal');
  });

  it('writes a rumor into the journal and changes nothing else', () => {
    const w = parkedAt('bowl');
    w.turn = 77;

    const next = askLocal(w, 'hattie', 'hattie.rumors');

    expect(next.player.notes).toEqual([{ id: 'wagonBowl', turn: 77 }]);
    expect(next.events).toEqual([{ t: 'note', id: 'wagonBowl' }]);
    expect(untouched(next)).toEqual(untouched(w));
  });

  it('answers a lore question with no note and no change', () => {
    const w = parkedAt('bowl');

    const next = askLocal(w, 'ruben', 'ruben.oldWorld');

    expect(next.player.notes).toEqual([]);
    expect(next.events).toEqual([]);
    expect(untouched(next)).toEqual(untouched(w));
  });

  it('refuses talk away from the town, about a closed topic, or about an unknown one', () => {
    const away = parkedAt('nose');
    const bowl = parkedAt('bowl');
    const nose = parkedAt('nose');

    expect(() => askLocal(away, 'hattie', 'hattie.rumors')).toThrow(/Not parked at bowl/);
    expect(() => askLocal(nose, 'kovac', 'kovac.wagon')).toThrow(/does not take up/);
    expect(() => askLocal(bowl, 'hattie', 'ruben.place')).toThrow(/does not take up/);
    expect(() => askLocal(bowl, 'hattie', 'nonsense' as keyof typeof LOCAL_TOPICS)).toThrow(/No local topic/);
  });
});

describe('the lost wagon chain', () => {
  it('leads from Hattie at Bowl to Kovac at Nose, and closes once the wagon is searched', () => {
    let w = parkedAt('bowl');
    w = askLocal(w, 'hattie', 'hattie.rumors');
    w.vehicles[0].pos = { ...sitePads(site('nose'))[0] };

    w = askLocal(w, 'kovac', 'kovac.wagon');
    expect(topicIds(w, 'kovac')).not.toContain('kovac.wagonFound');
    w.player.scavenged.push(WAGON_SEVEN);
    w = askLocal(w, 'kovac', 'kovac.wagonFound');

    expect(w.player.notes.map((n) => n.id)).toEqual(['wagonBowl', 'wagonNose', 'wagonFound']);
  });

  it('asks again with no second note', () => {
    let w = parkedAt('bowl');
    w = askLocal(w, 'hattie', 'hattie.rumors');

    w = askLocal(w, 'hattie', 'hattie.rumors');

    expect(w.player.notes.map((n) => n.id)).toEqual(['wagonBowl']);
    expect(w.events).toEqual([]);
  });
});

describe('work by talk', () => {
  it('names the best-paying open offer on the town board', () => {
    const w = parkedAt('bowl');
    w.shops.bowl.contracts = [haul('ct-low', 100), haul('ct-high', 300), { ...haul('ct-gone', 900), deadline: -1 }];

    expect(localWork(w, 'dag')?.id).toBe('ct-high');
    expect(workLine(w, 'dag', 'dag.work')).toBe(LOCAL_TOPICS['dag.work'].work!.offer);
  });

  it('has nothing when the board is empty or the player holds the most contracts', () => {
    const empty = parkedAt('bowl');
    empty.shops.bowl.contracts = [];
    const full = parkedAt('bowl');
    full.shops.bowl.contracts = [haul('ct-high', 300)];
    full.player.contracts = Array.from({ length: CONTRACTS.maxActive }, (_, k) => haul(`held${k}`, 10));

    expect(localWork(empty, 'dag')).toBeNull();
    expect(workLine(empty, 'dag', 'dag.work')).toBe(LOCAL_TOPICS['dag.work'].work!.empty);
    expect(localWork(full, 'dag')).toBeNull();
    expect(workLine(full, 'dag', 'dag.work')).toBe(LOCAL_TOPICS['dag.work'].work!.full);
  });

  it('takes the offer exactly as the board does', () => {
    const w = parkedAt('bowl');
    w.shops.bowl.contracts = [haul('ct-low', 100), haul('ct-high', 300)];

    expect(takeLocalWork(w, 'dag', 'ct-high')).toEqual(acceptContract(w, 'ct-high'));
    expect(() => takeLocalWork(w, 'dag', 'ct-low')).toThrow(/does not offer/);
  });
});
