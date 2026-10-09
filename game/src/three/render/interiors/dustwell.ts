import * as THREE from 'three';
import { PAL } from '../../../render/palette';
import { model, socket } from '../models';
import { rock } from '../site-motion';
import type { SiteBuilder } from '../sites';
import { addShed } from './shed';

const PUMP = { x: -1.6, z: 0.3, yaw: Math.PI / 2 };
const WELL = 7 / 4;
const STROKE = { amplitude: (18 * Math.PI) / 180, period: 6 };
const TANKS = [
  { x: 0.45, z: -2.2 },
  { x: 2.0, z: -2.0 },
];
const TANK_OUTLET = (2.6 + 0.45) / 4;
const SQUAT = { x: -0.1, z: 1.9, height: 0.42 };
const SHED = { x: 0.3, z: -0.3, yaw: -Math.PI / 2 };
const PIPE = { size: 0.08, lift: 0.12, support: 0.6 };
const LAMP_HEIGHT = 1.9;
const DUSTWELL_LAMPS = [
  { x: 1.5, z: 1.3 },
  { x: -1.7, z: 1.4 },
  { x: -1.2, z: -1.7 },
  { x: 2.4, z: -0.3 },
];
const PUMP_LIGHT = { lamp: 3, aim: { x: PUMP.x + 0.6, z: PUMP.z, lift: 0.3 } };

export function buildDustwell(b: SiteBuilder): void {
  addPumpjack(b);
  for (const tank of TANKS) b.addModel('storage_tank', tank.x, tank.z).name = 'dustwell-tank';
  b.addModel('storage_tank', SQUAT.x, SQUAT.z, 0.6, new THREE.Vector3(1, SQUAT.height, 1)).name = 'dustwell-tank';
  addShed(b, 'dustwell', SHED);
  addPipes(b);
  const heads = DUSTWELL_LAMPS.map((l) => b.addMast(l.x, l.z, LAMP_HEIGHT, Math.atan2(-l.z, -l.x)));
  b.addLight('flood', heads[PUMP_LIGHT.lamp], PUMP_LIGHT.aim, PAL.siteLight.sodium);
}

function addPumpjack(b: SiteBuilder): void {
  const base = b.addModel('pumpjack_base', PUMP.x, PUMP.z, PUMP.yaw);
  base.name = 'pumpjack';
  const beam = model('pumpjack_beam');
  beam.name = 'pumpjack-beam';
  beam.position.copy(socket('pumpjack_base', 'beam'));
  base.add(beam);
  b.addMover(beam, rock(new THREE.Vector3(0, 0, 1), STROKE.amplitude, STROKE.period));
}

function addPipes(b: SiteBuilder): void {
  const well = { x: PUMP.x, z: PUMP.z - WELL };
  const end = TANKS[TANKS.length - 1].x;
  const length = end - well.x;
  b.addBox(well.x + length / 2, well.z, length, PIPE.size, PIPE.size, PAL.metal, PIPE.lift);
  for (let x = well.x + PIPE.support; x < end; x += PIPE.support) b.addBox(x, well.z, PIPE.size, PIPE.lift, PIPE.size * 2, PAL.rust.dark);
  for (const tank of TANKS) {
    const outlet = tank.z + TANK_OUTLET;
    const run = Math.abs(well.z - outlet);
    b.addBox(tank.x, (well.z + outlet) / 2, PIPE.size, PIPE.size, run, PAL.metal, PIPE.lift);
  }
}
