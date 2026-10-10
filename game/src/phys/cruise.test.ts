
import { beforeAll, describe, expect, it } from 'vitest';
import { chassisDef } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { RULES } from '../data/rules';
import { TOW } from '../data/tow';
import { corePart } from '../sim/grid';
import { stowPart } from '../sim/inventory';
import { makePart } from '../sim/factory';
import { vehicleMass } from '../sim/mass';
import { npcHomeSite } from '../sim/tow';
import { addState } from '../sim/states';
import { fuelCap, vehicleStats } from '../sim/stats';
import { addVehicle, emptyWorld, npcBrain } from '../sim/testkit';
import type { Vehicle, World } from '../sim/types';
import { endTurn, setMoveOrder } from '../sim/world';
import { buildDrive, freeDrive, initPhysics, type Drive } from './drive';
import { physicsMove } from './turn';
import { TEST_MAP } from '../test/map';

beforeAll(async () => {
  await initPhysics();
});

const KPH = (PHYSICS.metersPerTile / PHYSICS.turnSeconds) * 3.6;
const CRUISE_KPH = 65;
const RAMP_TURNS = 8;
const ROAD_Y = 30;

function road(): World {
  return emptyWorld({ x: 70, y: ROAD_Y + 12 });
}

function truck(w: World, chassisId: string, parts: string[]): Vehicle {
  const v = addVehicle(w, 'scavengers', chassisId, parts, { x: 20, y: ROAD_Y }, 0);
  v.order = { kind: 'stopAt', dest: { x: 400, y: ROAD_Y } };
  return v;
}

function cruise(w: World, id: string): number {
  let d: Drive = buildDrive(w);
  for (let i = 0; i < RAMP_TURNS; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => { next = r.next; }));
    freeDrive(d);
    d = next!;
  }
  freeDrive(d);
  return w.vehicles.find((v) => v.id === id)!.speed;
}

describe('driven speed on an open road', () => {
  it('a healthy scout with a stock engine and one machine gun cruises at 65 km/h or more, near its top speed', () => {
    const w = road();
    const v = truck(w, 'scout', ['stockEngine', 'mg']);
    const top = vehicleStats(w, v).maxSpeed;
    const speed = cruise(w, v.id);
    expect(speed * KPH).toBeGreaterThanOrEqual(CRUISE_KPH);
    expect(speed).toBeGreaterThanOrEqual(0.95 * top);
  });

  it('a hauler loaded to the brim drives slower than the empty hauler', () => {
    const empty = road();
    const e = truck(empty, 'hauler', ['stockEngine']);
    const loaded = road();
    const l = truck(loaded, 'hauler', ['stockEngine']);
    while (stowPart(loaded, l, makePart(loaded, 'stockEngine', 0)));
    expect(vehicleMass(l)).toBeGreaterThan(0.6 * chassisDef('hauler').ratedMass);
    expect(cruise(loaded, l.id)).toBeLessThan(0.95 * cruise(empty, e.id));
  });

  it('a tower holds its tow share of its own top speed', () => {
    const w = road();
    const tower = w.vehicles[0];
    tower.pos = { x: 20, y: ROAD_Y };
    tower.heading = 0;
    const free = vehicleStats(w, tower).maxSpeed;
    const client = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 17, y: ROAD_Y }, 0);
    client.brain = npcBrain('scavenger', client.pos, ['scavenger']);
    addState(w, 'tow', tower.id, client.id, { kind: 'tow', site: npcHomeSite(TEST_MAP, client)!.id, fee: 0, waived: 0, hitched: true });
    const towed = setMoveOrder(w, { kind: 'stopAt', dest: { x: 400, y: ROAD_Y } });
    const speed = cruise(towed, tower.id);
    expect(speed).toBeLessThanOrEqual(TOW.speedShare * free + 0.3);
    expect(speed).toBeGreaterThan(0.8 * TOW.speedShare * free);
  });

  it('a truck with a broken transmission stays at limp speed', () => {
    const w = road();
    const v = truck(w, 'scout', ['stockEngine']);
    corePart(v, 'transmission').hp = 0;
    expect(cruise(w, v.id)).toBeLessThanOrEqual(RULES.limpSpeed + 0.3);
  });

  it('a truck under the low-fuel line drives at half its top speed', () => {
    const w = road();
    const v = truck(w, 'scout', ['stockEngine']);
    const top = vehicleStats(w, v).maxSpeed;
    v.resources!.fuel = 0.15 * fuelCap(v);
    const speed = cruise(w, v.id);
    expect(speed).toBeLessThanOrEqual(RULES.lowFuelSpeedFactor * top + 0.3);
    expect(speed).toBeGreaterThan(0.8 * RULES.lowFuelSpeedFactor * top);
  });
});
