import { consumeVehicleSupplies, fitStores, getResources } from "./resources";
import { RULES } from "../data/rules";
import { corePart } from "./grid";
import type { World } from "./types";

export function consumeSupplies(world: World): void {
  for (const vehicle of world.vehicles) consumeVehicleSupplies(world, vehicle);
}

export function fitAllStores(world: World): void {
  for (const vehicle of world.vehicles) fitStores(world, vehicle);
}

export function leakFuel(world: World): void {
  for (const vehicle of world.vehicles) {
    const resources = getResources(world, vehicle);
    if (corePart(vehicle, "tank").hp > 0 || resources.fuel <= 0) continue;
    const lost = Math.min(resources.fuel, RULES.tankLeak);
    resources.fuel -= lost;
    if (vehicle.id === world.player.vehicleId)
      world.events.push({
        t: "supply",
        what: "fuel",
        text: `Fuel tank leaks: fuel -${lost.toFixed(1)}`,
      });
  }
}
