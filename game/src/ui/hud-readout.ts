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
import { fuelCap, gunDraw, hasWorkingEngine, isStranded, isWorking, maxSpeedSteps, workingEngineCapacity, type SpeedStep } from "../sim/stats";
import { fuelLimit } from "../sim/far";
import { spareParts } from "../sim/inventory";
import { towData } from "../sim/states";
import { playerTow } from "../sim/tow";
import { heatAt } from "../sim/sun";
import { TERRAIN } from "../data/terrain";
import { dist, type Vec } from "../sim/vec";
import type { SalvageStock, Vehicle, World } from "../sim/types";
import { REGION } from "../data/region";
import { clock, vehicleName } from "./format";
import { celsius, engineCelsius, fuelLiters, hp, kg, kph } from "./units";
import { ENGINE_HEAT } from "../data/wear";
import type { IconName } from "./cards";
import { contextKey, type ContextAction } from './hud';
import { SHOPS } from '../data/market';
import { canUseSite, locationAt } from '../sim/sites';
import { shopAt } from '../sim/market';
import { canUseOasis, downedListNear, emptySalvageNear, lootBlockerHere, salvageListNear } from '../sim/locations';
import { canLootTruck, canReachSalvage, salvagePlace } from '../sim/salvage';
import { playerCanAct } from '../sim/world';
import { combatTurnsLeft } from '../sim/combat';
import { isBusy } from '../sim/jobs';
import { list, num, t, type Msg } from '../text/msg';
import { partName, siteName, vehicleTitle } from '../text/names';

// The shop in reach of the player truck at any speed, or null. Moving trucks must stop to use it.
function shopNear(world: World): string | null {
  const pos = playerVehicle(world).pos;
  const sites = [...REGION.towns, ...REGION.locations].filter((s) => s.id in SHOPS);
  return sites.find((s) => canUseSite(pos, s))?.id ?? null;
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
  const words = { goods: aidGoods(s), truck: vehicleTitle(world, vehicleById(world, s.holder)) };
  const label = aidData(s).giver === "player" ? t("action.giveAid", words) : t("action.takeAid", words);
  return { label, ready: readyAid(world) !== null, target: { kind: 'aid' } };
}

function getTradeAction(world: World): ContextAction | null {
  const partner = tradePartner(world);
  return partner && { label: t("action.trade", { truck: vehicleTitle(world, partner) }), ready: tradeReady(world) !== null, target: { kind: 'trade' } };
}

function getPlaceActions(world: World): ContextAction[] {
  const actions: ContextAction[] = [];
  const shop = shopNear(world);
  if (shop) actions.push({ label: t("action.enter", { site: siteName(shop) }), ready: shopAt(world) === shop, target: { kind: 'shop' } });
  // A knocked-out truck stays open to looting while a removal from it runs.
  for (const downed of downedListNear(world)) {
    actions.push({ label: t("action.lootTruck", { truck: vehicleTitle(world, downed) }), ready: canLootTruck(playerVehicle(world), downed), target: { kind: 'downed', id: downed.id } });
  }
  if (!isBusy(playerVehicle(world))) actions.push(...getSiteActions(world));
  return actions;
}

function getSiteActions(world: World): ContextAction[] {
  const oasis = locationAt(world);
  const actions: ContextAction[] = [];
  if (oasis?.kind === 'oasis') actions.push({ label: t("action.refill", { site: siteName(oasis.id) }), ready: canUseOasis(world), target: { kind: 'oasis' } });
  const stocks = salvageListNear(world);
  actions.push(...stocks.map((stock) => getStockAction(world, stock)));
  if (stocks.length === 0) {
    const empty = emptySalvageNear(world);
    if (empty) actions.push({ label: stockLabel('empty', empty), ready: false, hint: t("action.noLoot"), target: { kind: 'empty' } });
  }
  return actions;
}

// A search needs no combat. Looting a searched stock does not. Neither starts while another truck loots it.
function getStockAction(world: World, stock: SalvageStock): ContextAction {
  const target = { kind: 'stock', id: stock.id } as const;
  const searched = world.player.scavenged.includes(stock.id);
  const blocker = lootBlockerHere(world, stock.id);
  if (blocker) return { label: stockLabel(searched ? 'loot' : 'search', stock), ready: false, hint: t("action.lootingIt", { truck: vehicleTitle(world, blocker) }), target };
  const reachable = canReachSalvage(playerVehicle(world), stock);
  if (searched) return { label: stockLabel('loot', stock), ready: reachable, target };
  const combat = combatTurnsLeft(world, playerVehicle(world)) ?? undefined;
  return { label: stockLabel('search', stock), ready: combat === undefined && reachable, combat, target };
}

// What the prompt does with the stock: the verb alone at a loot spot that has no name, since a farmhouse or a hangar
// needs none, else the verb and what the stock is.
function stockLabel(verb: 'search' | 'loot' | 'empty', stock: SalvageStock): Msg {
  const place = salvagePlace(stock);
  if (place === 'pile' || place === 'wreck' || place === 'spot') return t(`stock.${verb}.${place}`);
  return t(`stock.${verb}.site`, { site: siteName(stock.id) });
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
export function conditionLabel(part: { name: Msg; percent: number }): Msg {
  return part.percent === 0 ? t("condition.broken", { part: part.name }) : t("condition.percent", { part: part.name, pct: part.percent });
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
          name: partName(def.id),
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

const HOT = 2; // heat at or above this shows as a warning

type WeatherWord = 'heatwave' | 'overcast' | 'storm' | 'stormNear';

// Storms are local: one shows only when the truck is inside it, or when its edge is within sight. clear is true
// when no weather shows.
function weatherLabel(w: World, pos: Vec): { text: Msg; clear: boolean } {
  const words = new Set<WeatherWord>();
  for (const e of w.weather) {
    if (e.kind !== "storm") words.add(e.kind);
    else if (dist(pos, e.pos) <= e.radius) words.add("storm");
    else if (dist(pos, e.pos) - e.radius <= TERRAIN.vision.radius) words.add("stormNear");
  }
  if (words.size === 0) return { text: t("weather.clear"), clear: true };
  return { text: list([...words].map((word) => t(`weather.${word}`))), clear: false };
}

// Negative money is debt. It shows as a positive amount owed.
export function moneyLabel(money: number): Msg {
  return money < 0 ? t("money.debt", { n: -money }) : t("money.amount", { n: money });
}

// What the rescue panel shows: the knockout, the tow in progress, or a stranded truck with its beacon switch. Null
// when none applies, and for a dead player, whom the death screen covers. A tow offer comes as a radio call.
export type RescueReadout =
  | { kind: "knockedOut" }
  | { kind: "towed"; tower: Msg; town: Msg; fee: number }
  | { kind: "stranded"; beacon: boolean; reason: Msg | null };

export function getRescueReadout(w: World): RescueReadout | null {
  const p = w.player;
  if (p.state === "knockedOut") return { kind: "knockedOut" };
  if (p.state === "dead") return null;
  const state = playerTow(w);
  if (state && towData(state).hitched) {
    const data = towData(state);
    return { kind: "towed", tower: vehicleName(w, state.holder), town: siteName(data.site), fee: data.fee };
  }
  if (p.beacon || isStranded(w, playerVehicle(w)))
    return { kind: "stranded", beacon: p.beacon, reason: strandedReason(w) };
  return null;
}

// What stops the truck, and what the player can do about it.
function strandedReason(w: World): Msg | null {
  const me = playerVehicle(w);
  if (!hasWorkingEngine(me)) {
    const spare = spareParts(me).some((part) => partDef(part.defId).kind === "engine");
    return spare ? t("stranded.spareEngine") : t("stranded.noEngine");
  }
  if (!isWorking(corePart(me, "transmission"))) return t("stranded.transmission");
  if (w.player.fuel <= 0) return t("stranded.noFuel");
  return null;
}

// Max-speed rows and the power chip: the sim's steps and power facts, worded tersely for the HUD tooltip and the truck headers.
// Each row shows its cause, its effect and the running km/h. The last row is the total the HUD shows.
export type SpeedRow = { label: Msg; effect: Msg; kph: number; total: boolean };

export type PowerChip = { text: Msg; detail: Msg; over: boolean };

function percent(factor: number): Msg {
  const pct = Math.round((factor - 1) * 100);
  if (pct === 0) return t("speed.pctZero");
  return pct < 0 ? t("speed.pctDown", { n: -pct }) : t("speed.pctUp", { n: pct });
}

function byKph(delta: number): Msg {
  return delta < 0 ? t("speed.kphDown", { n: -delta }) : t("speed.kphUp", { n: delta });
}

// Power figures in the same one-decimal style as the item cards.
export function powerNumber(n: number): number {
  return Number(n.toFixed(1));
}

type Kind<K extends SpeedStep['kind']> = Extract<SpeedStep, { kind: K }>;
type Words = { label: Msg; effect: (deltaKph: number) => Msg };
// What each step is called and how its effect reads. A new step kind fails typecheck until it has an entry here.
type Wording = { [K in SpeedStep['kind']]: (step: Kind<K>, weather: Msg) => Words };

const byFactor = (factor: number) => () => percent(factor);

const WORDING: Wording = {
  chassis: () => ({ label: t("speed.chassis"), effect: () => t("speed.base") }),
  engine: (s) => ({ label: s.worn ? t("speed.engineWorn") : t("speed.engine"), effect: byKph }),
  load: (s) => ({ label: t("speed.load", { mass: kg(s.mass), rated: kg(s.rated) }), effect: byFactor(s.factor) }),
  wheels: (s) => ({ label: t("speed.wheels", { n: s.broken }), effect: byFactor(s.factor) }),
  guns: (s) => ({ label: t("speed.guns", { draw: powerNumber(s.draw), capacity: powerNumber(s.capacity) }), effect: byFactor(s.factor) }),
  floor: () => ({ label: t("speed.floor"), effect: byKph }),
  overdrive: (s) => ({ label: t("speed.overdrive"), effect: byFactor(s.factor) }),
  transmission: () => ({ label: t("speed.transmission"), effect: byKph }),
  limp: (s) => ({ label: t(`speed.limp.${s.cause}`), effect: () => t("speed.crawl") }),
  weather: (s, weather) => ({ label: t("speed.weather", { weather }), effect: byFactor(s.factor) }),
  towing: (s) => ({ label: t("speed.towing"), effect: byFactor(s.factor) }),
};

// One row per step, each with its effect and the running km/h of the rounded speed, so the rows chain to the total.
// weather is the HUD's label for the weather at the truck.
export function speedRows(weather: Msg, steps: SpeedStep[]): SpeedRow[] {
  return steps.map((step, i) => {
    const words = (WORDING[step.kind] as (step: SpeedStep, weather: Msg) => Words)(step, weather);
    const speed = kph(step.speed);
    return { label: words.label, effect: words.effect(i === 0 ? 0 : speed - kph(steps[i - 1].speed)), kph: speed, total: i === steps.length - 1 };
  });
}

// Short notes for what the number leaves out: a low or empty tank, and how gun power works.
export function speedNotes(w: World, v: Vehicle, steps: SpeedStep[]): Msg[] {
  const notes: Msg[] = [];
  const driving = steps.some((s) => s.kind === 'guns');
  if (driving) notes.push(t("speed.gunNote", { pct: Math.round((1 - RULES.gunDragMax) * 100) }));
  const fuel = fuelLimit(w, v, driving);
  if (fuel === 'low') notes.push(t("speed.lowFuel", { pct: percent(RULES.lowFuelSpeedFactor) }));
  if (fuel === 'empty') notes.push(t("speed.emptyTank"));
  return notes;
}

// The guns step, and the speed before it. Null while a stalled or missing engine skips the engine path.
function gunStep(steps: SpeedStep[]): { step: Kind<'guns'>; before: number } | null {
  const i = steps.findIndex((s) => s.kind === 'guns');
  const step = steps[i];
  return step?.kind === 'guns' ? { step, before: steps[i - 1].speed } : null;
}

// What the draw costs: the short chip text and the full-sentence form.
function gunCost(steps: SpeedStep[]): { short: Msg; long: Msg } {
  const guns = gunStep(steps);
  if (!guns) return { short: t("power.noCostStalled"), long: t("power.noneStalled") };
  const lost = kph(guns.before) - kph(guns.step.speed);
  if (lost === 0) return { short: t("power.noCost"), long: t("power.none") };
  const pct = percent(guns.step.factor);
  return { short: t("power.cost", { pct }), long: t("power.costLong", { pct, n: lost }) };
}

// The header chip: working-gun draw against engine capacity, and what the draw costs in top speed.
export function powerChip(steps: SpeedStep[], v: Vehicle): PowerChip {
  const capacity = workingEngineCapacity(v);
  if (capacity === null) {
    return { text: t("power.noEngine"), detail: t("power.noEngineDetail"), over: false };
  }
  const draw = gunDraw(v);
  const over = draw > capacity;
  const balance = over ? t("power.over", { n: powerNumber(draw - capacity) }) : t("power.spare", { n: powerNumber(capacity - draw) });
  const cost = gunCost(steps);
  const power = { draw: powerNumber(draw), capacity: powerNumber(capacity) };
  const detail = t("power.detail", { ...power, balance, cost: cost.long });
  const text = over ? t("power.chipOver", { ...power, balance, cost: cost.short }) : t("power.chip", { ...power, cost: cost.short });
  return { text, detail, over };
}

// A HUD readout. id names the resource for data-resource, so scripts find it in any language.
export type Readout = { id: string; label: Msg; value: Msg; warning: boolean; progress?: number };

export function getHudReadout(w: World) {
  const me = playerVehicle(w);
  const capacity = fuelCap(me);
  const p = w.player;
  const maxHealth = maxHealthOf(w);
  const heat = heatAt(w, me.pos);
  const weather = weatherLabel(w, me.pos);
  const steps = maxSpeedSteps(w, me);
  const resources: Readout[] = [
    { id: "money", label: t("readout.money"), value: moneyLabel(p.money), warning: p.money < 0 },
    { id: "fuel", label: t("readout.fuel"), value: t("readout.liters", { n: fuelLiters(p.fuel), max: fuelLiters(capacity) }), warning: p.fuel < capacity * RULES.lowFuelThreshold },
    { id: "supplies", label: t("readout.supplies"), value: num(p.supplies, "dec1"), warning: p.supplies <= RULES.suppliesLow },
    { id: "driver", label: t("readout.driver"), value: t("readout.ofMax", { n: hp(p.health), max: maxHealth }), warning: p.health < maxHealth },
  ];
  const storm = w.weather.some((e) => e.kind === "storm" && dist(me.pos, e.pos) - e.radius <= TERRAIN.vision.radius);
  const survival: Readout[] = [
    { id: "heat", label: t("readout.heat"), value: t("readout.celsius", { n: celsius(heat) }), warning: heat >= HOT },
    { id: "engine", label: t("readout.engine"), value: t("readout.celsius", { n: engineCelsius(p.engineHeat) }), warning: p.engineHeat >= ENGINE_HEAT.warnAt, progress: p.engineHeat },
    { id: "weather", label: t("readout.weather"), value: weather.text, warning: !weather.clear && storm },
  ];
  return {
    speed: kph(me.speed),
    maxSpeed: kph(steps[steps.length - 1].speed),
    maxSpeedRows: speedRows(weather.text, steps),
    maxSpeedNotes: speedNotes(w, me, steps),
    manual: me.direct,
    clock: clock(w.turn),
    resources,
    survival,
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

// The version the ? menu shows and bug reports name, like "v0.4.1". It is a code, the same in every language.
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
