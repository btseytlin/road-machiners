// The sim speaks ids, never English: a seeded world played for many turns holds no phrase in its events, goals or
// call, so every language can show them. Driver names are the one exception, and they live in brain.driver.
import { describe, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { TEST_MAP } from '../test/map';
import { defaultSetup } from './settings';
import { testDrive } from './testkit';
import type { World } from './types';
import { endTurn, newWorld } from './world';

const PHRASE = /[A-Za-z]{2,} [A-Za-z]{2,}/;

// Every string inside a value, with the path to it.
function strings(value: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
  return out;
}

function phrases(w: World): [string, string][] {
  const goals = w.vehicles.flatMap((v) => v.brain?.goals ?? []);
  return [...strings(w.events, 'events'), ...strings(goals, 'goals'), ...strings(w.player.call, 'call')].filter(([, s]) => PHRASE.test(s));
}

describe('the sim keeps no English', () => {
  it('holds no phrase in events, goals or the call over many turns', () => {
    let w = newWorld(7, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const found: [string, string][] = [];
    let events = 0;
    for (let turn = 0; turn < 120; turn++) {
      w = endTurn(w, testDrive);
      events += w.events.length;
      found.push(...phrases(w));
    }
    expect(events).toBeGreaterThan(50);
    expect(found).toEqual([]);
  }, 120_000);

  it('the check catches a phrase', () => {
    const w = newWorld(7, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    w.events = [{ t: 'arrived', vehicle: 'Some truck' }];
    expect(phrases(w)).toEqual([['events[0].vehicle', 'Some truck']]);
  });
});
