import { GAME_VERSION } from "../config";
import { playerAid, readyAid } from "../sim/aid";
import { aidData } from "../sim/states";
import { aidGoods } from "./format";
import { tradePartner, tradeReady } from "../sim/economy";
import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { maxHp } from "../sim/wear";
import { playerVehicle, vehicleById } from "../sim/damage";
import { maxHealthOf } from "../sim/health";
import { baseGrid, corePart, mountedParts, mountedItems, itemSize, MOUNT_CELLS } from "../sim/grid";
import { fuelCap, hasWorkingEngine, isStranded, isWorking, vehicleStats } from "../sim/stats";
import { spareParts } from "../sim/inventory";
import { towData } from "../sim/states";
import { playerTow } from "../sim/tow";
import { heatAt } from "../sim/sun";
import { TERRAIN } from "../data/terrain";
import { dist, type Vec } from "../sim/vec";
import type { SalvageStock, Vehicle, World } from "../sim/types";
import { REGION } from "../data/region";
import { clockLabel, vehicleName } from "./format";
import { celsius, engineCelsius, fuelLiters, hp, kph } from "./units";
import { ENGINE_HEAT } from "../data/wear";
import type { IconName } from "./cards";
import type { ContextAction } from './hud';
import { SHOPS } from '../data/market';
import { canUseSite, locationAt } from '../sim/sites';
import { shopAt } from '../sim/market';
import { canUseOasis, downedHere, downedNear, emptySalvageNear, lootBlockerHere, salvageHere, salvageNear } from '../sim/locations';
import { playerCanAct } from '../sim/world';
import { combatTurnsLeft } from '../sim/combat';
import { isBusy } from '../sim/jobs';
import { npcName } from '../sim/spawn';

// The shop in reach of the player truck at any speed, or null. Moving trucks must stop to use it.
function shopNear(world: World): { id: string; name: string } | null {
  const pos = playerVehicle(world).pos;
  const sites = [...REGION.towns, ...REGION.locations].filter((s) => s.id in SHOPS);
  const site = sites.find((s) => canUseSite(pos, s));
  return site ? { id: site.id, name: site.name } : null;
}

export function getContextAction(world: World, playing: boolean): ContextAction | null {
  if (playing || !playerCanAct(world)) return null;
  // An aid handover or a trade the player arranged wins over the place once both trucks are parked side by side.
  const deals = [getAidAction(world), getTradeAction(world)].filter((d) => d !== null);
  return deals.find((d) => d.ready) ?? getPlaceAction(world) ?? deals[0] ?? null;
}

// An agreed aid deal the player has not started yet.
function getAidAction(world: World): ContextAction | null {
  const s = playerAid(world);
  if (!s || !aidData(s).agreed || aidData(s).started) return null;
  const npc = npcName(vehicleById(world, s.holder));
  const label = aidData(s).giver === "player" ? `Give ${aidGoods(s)} to ${npc}` : `Take ${aidGoods(s)} from ${npc}`;
  return { label, ready: readyAid(world) !== null };
}

function getTradeAction(world: World): ContextAction | null {
  const partner = tradePartner(world);
  return partner && { label: `Trade with ${npcName(partner)}`, ready: tradeReady(world) !== null };
}

function getPlaceAction(world: World): ContextAction | null {
  const shop = shopNear(world);
  if (shop) return { label: `Enter ${shop.name}`, ready: shopAt(world) === shop.id };
  // A knocked-out truck stays open to looting while a removal from it runs.
  const downed = downedNear(world);
  if (downed) return { label: `Loot ${npcName(downed)}`, ready: downedHere(world) !== null };
  if (isBusy(playerVehicle(world))) return null;
  return getSiteAction(world);
}

function getSiteAction(world: World): ContextAction | null {
  const oasis = locationAt(world);
  if (oasis?.kind === 'oasis')
    return { label: `Refill supplies at ${oasis.name}`, ready: canUseOasis(world) };
  const stock = salvageNear(world);
  if (!stock) {
    const empty = emptySalvageNear(world);
    return empty && { label: `${getSalvageName(empty)} is picked clean`, ready: false, hint: 'No loot left' };
  }
  return getStockAction(world, stock);
}

// A search needs no combat. Looting a searched stock does not. Neither starts while another truck loots it.
function getStockAction(world: World, stock: SalvageStock): ContextAction {
  const searched = world.player.scavenged.includes(stock.id);
  const blocker = lootBlockerHere(world);
  if (blocker) return { label: `${searched ? 'Loot' : 'Search'} ${getSalvageName(stock)}`, ready: false, hint: `${blocker.name} is looting it` };
  if (searched) return { label: `Loot ${getSalvageName(stock)}`, ready: salvageHere(world) !== null };
  const combat = combatTurnsLeft(world, playerVehicle(world)) ?? undefined;
  return { label: `Search ${getSalvageName(stock)}`, ready: combat === undefined && salvageHere(world) !== null, combat };
}

function getSalvageName(stock: SalvageStock): string {
  if (stock.pile) return 'the pile';
  return REGION.locations.find((site) => site.id === stock.id)?.name ?? 'the wreck';
}

function getConditionIcon(def: ReturnType<typeof partDef>): IconName {
  if (def.kind === "core") return def.role === "tank" ? "fuel" : def.role;
  if (def.kind === "weapon") return def.look;
  if (def.kind === "armor") return "armor";
  return "engine" as const;
}

function getConditionState(ratio: number): string {
  if (ratio <= 0.25) return "critical";
  return ratio < 1 ? "damaged" : "healthy";
}

// Armor edge cells with no armor mounted on them: the stripped spots of a truck.
export function openArmorSlots(vehicle: Vehicle): { x: number; y: number }[] {
  const covered = new Set<string>();
  for (const item of mountedItems(vehicle, "armor")) {
    const { w, h } = itemSize(item);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) covered.add(`${item.x + dx},${item.y + dy}`);
  }
  const open: { x: number; y: number }[] = [];
  baseGrid(vehicle.chassisId).cells.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (cell && MOUNT_CELLS.armor.includes(cell) && !covered.has(`${x},${y}`)) open.push({ x, y });
    }));
  return open;
}

// The tooltip of a part tile: the part's name and condition.
export function conditionLabel(part: { name: string; percent: number }): string {
  return part.percent === 0 ? `${part.name}: broken` : `${part.name}: ${part.percent}%`;
}

export class TruckConditionReadout {
  private vehicleId: string | null = null;
  private health = new Map<string, number>();

  update(vehicle: Vehicle) {
    if (this.vehicleId !== vehicle.id) this.health.clear();
    this.vehicleId = vehicle.id;
    const previous = this.health;
    this.health = new Map();
    return mountedItems(vehicle)
      .filter((item) =>
        ["core", "engine", "weapon", "armor"].includes(partDef(item.part.defId).kind),
      )
      .map((item) => {
        const def = partDef(item.part.defId);
        const hp = item.part.hp;
        this.health.set(item.part.id, hp);
        const before = previous.get(item.part.id);
        const ratio = hp / maxHp(item.part);
        return {
          id: item.part.id,
          name: def.name,
          icon: getConditionIcon(def),
          x: item.x,
          y: item.y,
          ...itemSize(item),
          percent: hp > 0 ? Math.max(1, Math.floor(ratio * 100)) : 0,
          state: getConditionState(ratio),
          broken: hp <= 0,
          hit: before !== undefined && hp < before,
        };
      });
  }
}

const REGION_WEATHER: Record<"heatwave" | "overcast", string> = {
  heatwave: "Heat wave",
  overcast: "Overcast",
};
const HOT = 2; // heat at or above this shows as a warning

// Storms are local: one shows only when the truck is inside it, or when its edge is within sight.
function weatherLabel(w: World, pos: Vec): string {
  const names: string[] = [];
  for (const e of w.weather) {
    if (e.kind !== "storm") names.push(REGION_WEATHER[e.kind]);
    else if (dist(pos, e.pos) <= e.radius) names.push("Dust storm");
    else if (dist(pos, e.pos) - e.radius <= TERRAIN.vision.radius)
      names.push("Storm near");
  }
  return names.length ? [...new Set(names)].join(", ") : "Clear";
}

// Negative money is debt. It shows as a positive amount owed.
export function moneyLabel(money: number): string {
  return money < 0
    ? `Debt ${(-money).toLocaleString("en-US")}`
    : money.toLocaleString("en-US");
}

// What the rescue panel shows: the knockout, the tow in progress, or a stranded truck with its beacon switch. Null
// when none applies, and for a dead player, whom the death screen covers. A tow offer comes as a radio call.
export type RescueReadout =
  | { kind: "knockedOut" }
  | { kind: "towed"; tower: string; town: string; fee: number }
  | { kind: "stranded"; beacon: boolean; reason: string };

export function getRescueReadout(w: World): RescueReadout | null {
  const p = w.player;
  if (p.state === "knockedOut") return { kind: "knockedOut" };
  if (p.state === "dead") return null;
  const state = playerTow(w);
  if (state && towData(state).hitched) {
    const data = towData(state);
    return { kind: "towed", tower: vehicleName(w, state.holder), town: townName(data.site), fee: data.fee };
  }
  if (p.beacon || isStranded(w, playerVehicle(w)))
    return { kind: "stranded", beacon: p.beacon, reason: strandedReason(w) };
  return null;
}

// What stops the truck, and what the player can do about it.
function strandedReason(w: World): string {
  const me = playerVehicle(w);
  if (!hasWorkingEngine(me)) {
    const spare = spareParts(me).some((part) => partDef(part.defId).kind === "engine");
    return spare ? "No working engine. Install the spare [I]." : "No working engine.";
  }
  if (!isWorking(corePart(me, "transmission"))) return "The transmission is broken.";
  if (w.player.fuel <= 0) return "Out of fuel.";
  return "";
}

function townName(id: string): string {
  const town = REGION.towns.find((t) => t.id === id);
  if (!town) throw new Error(`Unknown town ${id}`);
  return town.name;
}

export function getHudReadout(w: World) {
  const me = playerVehicle(w);
  const capacity = fuelCap(me);
  const p = w.player;
  const maxHealth = maxHealthOf(w);
  const heat = heatAt(w, me.pos);
  const weather = weatherLabel(w, me.pos);
  return {
    speed: String(kph(me.speed)),
    maxSpeed: String(kph(vehicleStats(w, me).maxSpeed)),
    manual: me.direct,
    broken: mountedParts(me).filter((part) => part.hp === 0).length,
    resources: [
      {
        label: "Money",
        value: moneyLabel(p.money),
        warning: p.money < 0,
      },
      {
        label: "Fuel",
        value: `${fuelLiters(p.fuel)} / ${fuelLiters(capacity)} L`,
        warning: p.fuel < capacity * RULES.lowFuelThreshold,
      },
      {
        label: "Supplies",
        value: p.supplies.toFixed(1),
        warning: p.supplies <= RULES.suppliesLow,
      },
      {
        label: "Driver",
        value: `${hp(p.health)} / ${maxHealth}`,
        warning: p.health < maxHealth,
      },
    ],
    survival: [
      { label: "Time", value: clockLabel(w.turn), warning: false },
      { label: "Heat", value: `${celsius(heat)} °C`, warning: heat >= HOT },
      {
        label: "Engine",
        value: `${engineCelsius(p.engineHeat)} °C`,
        warning: p.engineHeat >= ENGINE_HEAT.warnAt,
        progress: p.engineHeat,
      },
      {
        label: "Weather",
        value: weather,
        warning:
          weather !== "Clear" &&
          w.weather.some(
            (e) =>
              e.kind === "storm" &&
              dist(me.pos, e.pos) - e.radius <= TERRAIN.vision.radius,
          ),
      },
    ],
  };
}

// The issue forms in .github/ISSUE_TEMPLATE/.
const NEW_ISSUE_URL = "https://github.com/btseytlin/road-machiners/issues/new";

function issueFormUrl(template: string, fields: Record<string, string>): string {
  const url = new URL(NEW_ISSUE_URL);
  url.searchParams.set("template", template);
  for (const [id, value] of Object.entries(fields)) url.searchParams.set(id, value);
  return url.href;
}

// The text the ? menu shows.
export function versionLabel(): string {
  return `v${GAME_VERSION}`;
}

// The form field id is `version`, so GitHub prefills that field.
export function bugReportUrl(version: string): string {
  return issueFormUrl("bug.yml", { version });
}

// The feature form has no version field.
export function featureRequestUrl(): string {
  return issueFormUrl("feature-request.yml", {});
}
