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
import { corePart, mountedItems, itemSize } from "../sim/grid";
import { fuelCap, gunDraw, hasWorkingEngine, isStranded, isWorking, maxSpeedSteps, vehicleStats, workingEngineCapacity, type SpeedStep, type VehicleStats } from "../sim/stats";
import { fuelLimit } from "../sim/far";
import { spareParts } from "../sim/inventory";
import { towData } from "../sim/states";
import { playerTow } from "../sim/tow";
import { heatAt } from "../sim/sun";
import { TERRAIN } from "../data/terrain";
import { dist, type Vec } from "../sim/vec";
import type { SalvageStock, Vehicle, World } from "../sim/types";
import { REGION } from "../data/region";
import { clockLabel, vehicleName } from "./format";
import { celsius, engineCelsius, fuelLiters, hp, kg, kph } from "./units";
import { ENGINE_HEAT } from "../data/wear";
import type { IconName } from "./cards";
import { contextKey, type ContextAction } from './hud';
import { SHOPS } from '../data/market';
import { canUseSite, locationAt } from '../sim/sites';
import { shopAt } from '../sim/market';
import { canUseOasis, downedListNear, emptySalvageNear, lootBlockerHere, salvageListNear } from '../sim/locations';
import { canLootTruck, canReachSalvage } from '../sim/salvage';
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

// Holds which of the actions in reach the E key runs. The selection is UI state only and is never saved.
export class ContextPicker {
  private selected: string | null = null;

  // The selected action while it is still listed, else the first one, which becomes the selection.
  pick(actions: ContextAction[]): ContextAction | null {
    const found = actions.find((a) => contextKey(a.target) === this.selected) ?? actions[0] ?? null;
    this.selected = found && contextKey(found.target);
    return found;
  }

  // Moves the selection by one entry and wraps at both ends.
  cycle(actions: ContextAction[], step: 1 | -1): void {
    const current = this.pick(actions);
    if (!current) return;
    const next = (actions.indexOf(current) + step + actions.length) % actions.length;
    this.selected = contextKey(actions[next].target);
  }
}

// Every action in reach, the default first. The player picks between them with the arrow keys.
export function getContextActions(world: World, playing: boolean): ContextAction[] {
  if (playing || !playerCanAct(world)) return [];
  // An aid handover or a trade the player arranged wins over the place once both trucks are parked side by side.
  const deals = [getAidAction(world), getTradeAction(world)].filter((d) => d !== null);
  return [...deals.filter((d) => d.ready), ...getPlaceActions(world), ...deals.filter((d) => !d.ready)];
}

// An agreed aid deal the player has not started yet.
function getAidAction(world: World): ContextAction | null {
  const s = playerAid(world);
  if (!s || !aidData(s).agreed || aidData(s).started) return null;
  const npc = npcName(vehicleById(world, s.holder));
  const label = aidData(s).giver === "player" ? `Give ${aidGoods(s)} to ${npc}` : `Take ${aidGoods(s)} from ${npc}`;
  return { label, ready: readyAid(world) !== null, target: { kind: 'aid' } };
}

function getTradeAction(world: World): ContextAction | null {
  const partner = tradePartner(world);
  return partner && { label: `Trade with ${npcName(partner)}`, ready: tradeReady(world) !== null, target: { kind: 'trade' } };
}

function getPlaceActions(world: World): ContextAction[] {
  const actions: ContextAction[] = [];
  const shop = shopNear(world);
  if (shop) actions.push({ label: `Enter ${shop.name}`, ready: shopAt(world) === shop.id, target: { kind: 'shop' } });
  // A knocked-out truck stays open to looting while a removal from it runs.
  for (const downed of downedListNear(world)) {
    actions.push({ label: `Loot ${npcName(downed)}`, ready: canLootTruck(playerVehicle(world), downed), target: { kind: 'downed', id: downed.id } });
  }
  if (!isBusy(playerVehicle(world))) actions.push(...getSiteActions(world));
  return actions;
}

function getSiteActions(world: World): ContextAction[] {
  const oasis = locationAt(world);
  const actions: ContextAction[] = [];
  if (oasis?.kind === 'oasis') actions.push({ label: `Refill supplies at ${oasis.name}`, ready: canUseOasis(world), target: { kind: 'oasis' } });
  const stocks = salvageListNear(world);
  actions.push(...stocks.map((stock) => getStockAction(world, stock)));
  if (stocks.length === 0) {
    const empty = emptySalvageNear(world);
    if (empty) actions.push({ label: `${getSalvageName(empty)} is picked clean`, ready: false, hint: 'No loot left', target: { kind: 'empty' } });
  }
  return actions;
}

// A search needs no combat. Looting a searched stock does not. Neither starts while another truck loots it.
function getStockAction(world: World, stock: SalvageStock): ContextAction {
  const target = { kind: 'stock', id: stock.id } as const;
  const searched = world.player.scavenged.includes(stock.id);
  const blocker = lootBlockerHere(world, stock.id);
  if (blocker) return { label: `${searched ? 'Loot' : 'Search'} ${getSalvageName(stock)}`, ready: false, hint: `${blocker.name} is looting it`, target };
  const reachable = canReachSalvage(playerVehicle(world), stock);
  if (searched) return { label: `Loot ${getSalvageName(stock)}`, ready: reachable, target };
  const combat = combatTurnsLeft(world, playerVehicle(world)) ?? undefined;
  return { label: `Search ${getSalvageName(stock)}`, ready: combat === undefined && reachable, combat, target };
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


// The tooltip of a part tile: the part's name and condition.
export function conditionLabel(part: { name: string; percent: number }): string {
  return part.percent === 0 ? `${part.name} · broken` : `${part.name} · ${part.percent}%`;
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
          defId: def.id,
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

// Max-speed rows and the power chip: the sim's steps and power facts, worded for the HUD tooltip and the truck headers.
export type SpeedRow = { label: string; effect: string; kph: number };

export type PowerChip = { text: string; detail: string; over: boolean };

const MINUS = '−';

function signed(n: number, unit: string): string {
  return `${n < 0 ? MINUS : '+'}${Math.abs(n)}${unit}`;
}

function percent(factor: number): string {
  const pct = Math.round((factor - 1) * 100);
  return pct === 0 ? '0%' : signed(pct, '%');
}

// Power figures in the same one-decimal style as the item cards.
export function powerNumber(n: number): string {
  return String(Number(n.toFixed(1)));
}

function limpLabel(step: Extract<SpeedStep, { kind: 'limp' }>): string {
  const cause = { noEngine: 'No engine', brokenEngine: 'Engine broken', stalled: 'Engine stalled' }[step.cause];
  const skill = step.skill > 0 ? `, driving skill +${Math.round(step.skill * 100)}%` : '';
  return `${cause}: pushed at crawl speed${skill}`;
}

type Kind<K extends SpeedStep['kind']> = Extract<SpeedStep, { kind: K }>;
type RowText = Omit<SpeedRow, 'kph'>;
// What each step reads like. A new step kind fails typecheck until it has an entry here.
type Wording = { [K in SpeedStep['kind']]: (step: Kind<K>, before: number, weather: string) => RowText };

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const WORDING: Wording = {
  chassis: () => ({ label: 'Chassis', effect: 'base' }),
  engine: (s, before) => ({ label: s.worn ? 'Engine (worn)' : 'Engine', effect: signed(kph(s.speed) - kph(before), ' km/h') }),
  load: (s) => ({ label: `Load ${kg(s.mass)} / ${kg(s.rated)}`, effect: percent(s.factor) }),
  wheels: (s) => ({ label: `${plural(s.broken, 'broken wheel')}`, effect: percent(s.factor) }),
  guns: (s) => ({ label: `Gun power ${powerNumber(s.draw)} / ${powerNumber(s.capacity)}${s.capped ? ' (capped)' : ''}`, effect: percent(s.factor) }),
  floor: () => ({ label: 'Minimum speed', effect: 'raised' }),
  overdrive: (s) => ({ label: 'Overdrive', effect: percent(s.factor) }),
  transmission: () => ({ label: 'Broken transmission: crawl', effect: 'capped' }),
  limp: (s) => ({ label: limpLabel(s), effect: 'crawl' }),
  weather: (s, _before, weather) => ({ label: `Weather: ${weather}`, effect: percent(s.factor) }),
  towing: (s) => ({ label: 'Towing', effect: percent(s.factor) }),
};

function rowOf(weather: string, step: SpeedStep, before: number): RowText {
  const word = WORDING[step.kind] as (step: SpeedStep, before: number, weather: string) => RowText;
  return word(step, before, weather);
}

// One row per step. Each row's km/h is kph() of its running speed, so the numbers chain with no separately rounded deltas.
// weather is the HUD's label for the weather at the truck.
export function speedRows(weather: string, steps: SpeedStep[]): SpeedRow[] {
  return steps.map((step, i) => ({ ...rowOf(weather, step, i === 0 ? 0 : steps[i - 1].speed), kph: kph(step.speed) }));
}

// Plain-words notes under the total: how gun power costs speed, and a low or empty tank.
export function speedNotes(w: World, v: Vehicle, stats: VehicleStats): string[] {
  const notes = [
    `Guns draw engine power, and the draw is not a mounting limit. As the draw nears the engine's capacity, top speed and acceleration fall faster: the first guns cost little, and from full capacity on the cost stays at ${Math.round(RULES.gunDragMax * 100)}%. It is one total, not a cost per gun.`,
  ];
  const fuel = fuelLimit(w, v, stats);
  if (fuel === 'low') notes.push(`Low fuel: top speed drops to ${Math.round(RULES.lowFuelSpeedFactor * 100)}% on the road. This is not in the number above.`);
  if (fuel === 'empty') notes.push('Empty tank: the truck crawls. This is not in the number above.');
  return notes;
}

// The guns step, and the speed before it. Null while a stalled or missing engine skips the engine path.
function gunStep(steps: SpeedStep[]): { step: Kind<'guns'>; before: number } | null {
  const i = steps.findIndex((s) => s.kind === 'guns');
  const step = steps[i];
  return step?.kind === 'guns' ? { step, before: steps[i - 1].speed } : null;
}

// What the draw costs: the short chip text and the full-sentence form.
function gunCost(steps: SpeedStep[]): { short: string; long: string } {
  const guns = gunStep(steps);
  if (!guns) return { short: 'no speed cost while stalled', long: 'no speed cost while the engine is stalled' };
  const lost = kph(guns.before) - kph(guns.step.speed);
  if (lost === 0) return { short: 'no speed cost', long: 'no speed cost' };
  const pct = `${percent(guns.step.factor)} speed`;
  return { short: pct, long: `${pct}, ${MINUS}${lost} km/h` };
}

// The header chip: working-gun draw against engine capacity, and what the draw costs in top speed.
export function powerChip(steps: SpeedStep[], v: Vehicle): PowerChip {
  const capacity = workingEngineCapacity(v);
  if (capacity === null) {
    return { text: 'No working engine', detail: 'No working engine, so no power to supply or draw. Guns cost no speed until an engine runs.', over: false };
  }
  const draw = gunDraw(v);
  const over = draw > capacity;
  const balance = over ? `over by ${powerNumber(draw - capacity)}` : `${powerNumber(capacity - draw)} spare`;
  const cost = gunCost(steps);
  const detail = `Working guns draw ${powerNumber(draw)} of the engine's ${powerNumber(capacity)} power: ${balance}. This costs ${cost.long} and acceleration too. Draw is not a mounting limit, and the cost stays at ${Math.round(RULES.gunDragMax * 100)}% at most.`;
  const text = `${powerNumber(draw)} / ${powerNumber(capacity)} power${over ? ` · ${balance}` : ''} · ${cost.short}`;
  return { text, detail, over };
}

export function getHudReadout(w: World) {
  const me = playerVehicle(w);
  const capacity = fuelCap(me);
  const p = w.player;
  const maxHealth = maxHealthOf(w);
  const heat = heatAt(w, me.pos);
  const weather = weatherLabel(w, me.pos);
  const steps = maxSpeedSteps(w, me);
  return {
    speed: String(kph(me.speed)),
    maxSpeed: String(kph(steps[steps.length - 1].speed)),
    maxSpeedRows: speedRows(weather, steps),
    maxSpeedNotes: speedNotes(w, me, vehicleStats(w, me)),
    manual: me.direct,
    clock: clockLabel(w.turn),
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
