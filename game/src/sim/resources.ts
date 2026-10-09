import { RULES } from '../data/rules';
import { skillEffect } from './progress';
import { heatAt } from './sun';
import { fuelCap, suppliesCap, vehicleStats } from './stats';
import type { DriverResources, Vehicle, World } from './types';
import { supplyUseScale } from './settings';

export function getResources(world: World, vehicle: Vehicle): DriverResources {
  if (vehicle.id === world.player.vehicleId) return world.player;
  if (!vehicle.resources) throw new Error(`Missing resources for ${vehicle.id}`);
  return vehicle.resources;
}

export function burnFuel(world: World, vehicle: Vehicle, tiles: number): void {
  const resources = getResources(world, vehicle);
  const heat = heatAt(world, vehicle.pos);
  resources.fuel = Math.max(0, resources.fuel - tiles * vehicleStats(world, vehicle).fuelPerTile * heat);
}

function heatDrain(world: World, vehicle: Vehicle): number {
  const heat = heatAt(world, vehicle.pos);
  const cut = skillEffect(world, vehicle, 'toughness', 'heatDrain');
  return heat - Math.max(0, heat - 1) * cut;
}

export function consumeVehicleSupplies(world: World, vehicle: Vehicle): void {
  const resources = getResources(world, vehicle);
  const use = Math.max(0, 1 - skillEffect(world, vehicle, 'toughness', 'supplies'));
  resources.supplies = Math.max(0, resources.supplies - RULES.suppliesPerTurn * supplyUseScale(world) * use * heatDrain(world, vehicle));
  if (resources.supplies > 0) return;
  const lost = Math.max(0, Math.min(RULES.starveDamage, resources.health - RULES.starveFloor));
  if (lost === 0) return;
  resources.health -= lost;
  if (vehicle.id === world.player.vehicleId) world.events.push({ t: 'supply', what: 'supplies', text: `Out of supplies: health -${lost}` });
}

export function fitStores(world: World, vehicle: Vehicle): void {
  const resources = getResources(world, vehicle);
  const fuel = resources.fuel - fuelCap(vehicle);
  const supplies = resources.supplies - suppliesCap(vehicle);
  if (fuel > 0) resources.fuel -= fuel;
  if (supplies > 0) resources.supplies -= supplies;
  if (vehicle.id !== world.player.vehicleId) return;
  if (fuel > 0) world.events.push({ t: 'supply', what: 'fuel', text: `No room for fuel: fuel -${fuel.toFixed(1)}` });
  if (supplies > 0) world.events.push({ t: 'supply', what: 'supplies', text: `No room for supplies: supplies -${supplies.toFixed(1)}` });
}
