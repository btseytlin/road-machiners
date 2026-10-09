import { GAME_VERSION } from "../config";
import { playerAid, readyAid } from "../sim/aid";
import { aidData } from "../sim/states";
import { aidGoods } from "./format";
import { inMeetingReach, isMeeting, playerTrades } from "../sim/economy";
import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { maxHp } from "../sim/wear";
import { playerVehicle, vehicleById } from "../sim/damage";
import { maxHealthOf } from "../sim/health";
import { corePart, mountedItems, itemSize } from "../sim/grid";
import { canOverdrive, fuelCap, gunDraw, hasWorkingEngine, inOverdrive, isStranded, isWorking, maxSpeedSteps, workingEngineCapacity, type SpeedStep } from "../sim/stats";
import { fuelLimit, lowFuelSpeed } from "../sim/far";
import { spareParts } from "../sim/inventory";
import { towData } from "../sim/states";
import { playerTow } from "../sim/tow";
import { heatAt } from "../sim/sun";
import { TERRAIN } from "../data/terrain";
import { dist, type Vec } from "../sim/vec";
import type { NpcState, SalvageStock, Vehicle, World } from "../sim/types";
import { REGION } from "../data/region";
import { clockLabel, vehicleName } from "./format";
import { celsius, engineCelsius, fuelLiters, hp, kph, moneyNumber } from "./units";
import { ENGINE_HEAT } from "../data/wear";
import type { IconName } from "./cards";
import { contextKey, type ContextAction } from './hud';
import { SHOPS } from '../data/market';
import { canUseSite, locationAt } from '../sim/sites';
import { shopAt } from '../sim/market';
import { canUseOasis, downedListNear, emptySalvageNear, hasLootFor, lootBlockerHere, needsSearch, salvageListNear } from '../sim/locations';
import { canLootTruck, canReachSalvage, salvagePlace } from '../sim/salvage';
import { playerCanAct } from '../sim/world';
import { combatTurnsLeft } from '../sim/combat';
import { isBusy } from '../sim/jobs';
import { npcName } from '../sim/spawn';

export function overdriveSwitch(w: World): { checked: boolean; blocked: boolean; title: string } {
  const me = playerVehicle(w);
  const blocked = !canOverdrive(me);
  return {
    checked: inOverdrive(w, me),
    blocked,
    title: blocked
      ? `Engine too worn for overdrive: repair it above ${Math.round(RULES.overdriveMinEngineShare * 100)}% [O]`
      : "Engine overdrive: faster, but the engine heats fast [O]",
  };
}

function shopNear(world: World): { id: string; name: string } | null {
  const pos = playerVehicle(world).pos;
  const sites = [...REGION.towns, ...REGION.locations].filter((s) => s.id in SHOPS);
  const site = sites.find((s) => canUseSite(pos, s));
  return site ? { id: site.id, name: site.name } : null;
}

export class ContextPicker {
  private selected: string | null = null;

  pick(actions: ContextAction[]): ContextAction | null {
    const found = actions.find((a) => contextKey(a.target) === this.selected) ?? actions[0] ?? null;
    this.selected = found && contextKey(found.target);
    return found;
  }

  cycle(actions: ContextAction[], step: 1 | -1): void {
    const current = this.pick(actions);
    if (!current) return;
    const next = (actions.indexOf(current) + step + actions.length) % actions.length;
    this.selected = contextKey(actions[next].target);
  }
}

export function getContextActions(world: World, playing: boolean): ContextAction[] {
  if (playing || !playerCanAct(world)) return [];
  const deals = [getAidAction(world), ...getTradeActions(world)].filter((d) => d !== null);
  return [...deals.filter((d) => d.ready), ...getPlaceActions(world), ...deals.filter((d) => !d.ready)];
}

function awaitsStart(s: NpcState): boolean {
  return aidData(s).agreed && !aidData(s).started;
}

function getAidAction(world: World): ContextAction | null {
  const s = playerAid(world);
  if (!s || !awaitsStart(s) || !inMeetingReach(world, s)) return null;
  const npc = npcName(vehicleById(world, s.holder));
  const label = aidData(s).giver === "player" ? `Give ${aidGoods(s)} to ${npc}` : `Take ${aidGoods(s)} from ${npc}`;
  return { label, ready: readyAid(world)?.id === s.id, target: { kind: 'aid', id: s.holder } };
}

function getTradeActions(world: World): ContextAction[] {
  return playerTrades(world)
    .filter((s) => inMeetingReach(world, s))
    .map((s) => ({ label: `Trade with ${npcName(vehicleById(world, s.holder))}`, ready: isMeeting(world, s), target: { kind: 'trade', id: s.holder } }));
}

function getPlaceActions(world: World): ContextAction[] {
  const actions: ContextAction[] = [];
  const shop = shopNear(world);
  if (shop) actions.push({ label: `Enter ${shop.name}`, ready: shopAt(world) === shop.id, target: { kind: 'shop' } });
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
  actions.push(...stocks.flatMap((stock) => getStockActions(world, stock)));
  if (stocks.length === 0) {
    const empty = emptySalvageNear(world);
    if (empty) actions.push({ label: emptyLabel(empty), ready: false, hint: 'No loot left', target: { kind: 'empty' } });
  }
  return actions;
}

function getStockActions(world: World, stock: SalvageStock): ContextAction[] {
  const actions: ContextAction[] = [];
  if (needsSearch(world, stock)) actions.push(getSearchAction(world, stock));
  if (hasLootFor(world, stock)) actions.push(withBlocker(world, stock, { label: stockLabel('Loot', stock), ready: canReachSalvage(playerVehicle(world), stock), target: { kind: 'loot', id: stock.id } }));
  return actions;
}

function getSearchAction(world: World, stock: SalvageStock): ContextAction {
  const combat = combatTurnsLeft(world, playerVehicle(world)) ?? undefined;
  const ready = combat === undefined && canReachSalvage(playerVehicle(world), stock);
  return withBlocker(world, stock, { label: stockLabel('Search', stock), ready, combat, target: { kind: 'stock', id: stock.id } });
}

function withBlocker(world: World, stock: SalvageStock, action: ContextAction): ContextAction {
  const blocker = lootBlockerHere(world, stock.id);
  return blocker ? { label: action.label, ready: false, hint: `${blocker.name} is looting it`, target: action.target } : action;
}

function stockLabel(verb: 'Search' | 'Loot', stock: SalvageStock): string {
  const name = getSalvageName(stock);
  return name === null ? verb : `${verb} ${name}`;
}

function emptyLabel(stock: SalvageStock): string {
  const name = getSalvageName(stock);
  return name === null ? 'Picked clean' : `${name} is picked clean`;
}

function getSalvageName(stock: SalvageStock): string | null {
  const place = salvagePlace(stock);
  if (place === 'pile') return 'the pile';
  if (place === 'wreck') return 'the wreck';
  if (place === 'spot') return null;
  return siteName(stock.id);
}

function siteName(id: string): string {
  const site = REGION.locations.find((l) => l.id === id);
  if (!site) throw new Error(`Unknown site ${id}`);
  return site.name;
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
const HOT = 2;

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

export type SpeedRow = { label: string; text: string; delta: number };

export type PowerChip = { text: string; detail: string; over: boolean };

const MINUS = '−';

function signed(n: number, unit: string): string {
  return `${n < 0 ? MINUS : '+'}${Math.abs(n)}${unit}`;
}

function percent(factor: number): string {
  const pct = Math.round((factor - 1) * 100);
  return pct === 0 ? '0%' : signed(pct, '%');
}

export function powerNumber(n: number): string {
  return String(Number(n.toFixed(1)));
}

type Kind<K extends SpeedStep['kind']> = Extract<SpeedStep, { kind: K }>;
type Wording = { [K in SpeedStep['kind']]: (step: Kind<K>, weather: string) => string };

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const WORDING: Wording = {
  chassis: () => 'Chassis',
  engine: (s) => (s.worn ? 'Engine worn' : 'Engine'),
  load: () => 'Load',
  wheels: (s) => plural(s.broken, 'broken wheel'),
  guns: () => 'Guns power',
  floor: () => 'Minimum speed',
  overdrive: () => 'Overdrive',
  transmission: () => 'Broken transmission',
  limp: (s) => ({ noEngine: 'No engine', brokenEngine: 'Engine broken', stalled: 'Engine stalled' })[s.cause],
  weather: (_s, weather) => weather,
  towing: () => 'Towing',
};

function labelOf(weather: string, step: SpeedStep): string {
  const word = WORDING[step.kind] as (step: SpeedStep, weather: string) => string;
  return word(step, weather);
}
export function speedRows(weather: string, steps: SpeedStep[]): SpeedRow[] {
  const rows: SpeedRow[] = [];
  steps.forEach((step, i) => {
    const label = labelOf(weather, step);
    if (step.kind === 'limp') return void rows.push({ label, text: `${label}: crawl ${kph(step.speed)} km/h`, delta: 0 });
    if (i === 0) return;
    const delta = kph(step.speed) - kph(steps[i - 1].speed);
    if (delta !== 0) rows.push({ label, text: `${label}: ${signed(delta, ' km/h')}`, delta });
  });
  return rows;
}
export function speedNotes(w: World, v: Vehicle, steps: SpeedStep[]): string[] {
  const fuel = fuelLimit(w, v, steps.some((s) => s.kind === 'guns'));
  if (fuel === 'low') return [`Low fuel: max ${kph(lowFuelSpeed(steps[steps.length - 1].speed))} km/h`];
  if (fuel === 'empty') return ['Empty tank: crawl'];
  return [];
}

export function speedTip(rows: SpeedRow[], notes: string[]): string[] {
  const lines = [...rows.map((r) => r.text), ...notes];
  return lines.length > 0 ? lines : ['No speed penalties'];
}

function gunStep(steps: SpeedStep[]): { step: Kind<'guns'>; before: number } | null {
  const i = steps.findIndex((s) => s.kind === 'guns');
  const step = steps[i];
  return step?.kind === 'guns' ? { step, before: steps[i - 1].speed } : null;
}

function gunCost(steps: SpeedStep[]): { short: string; long: string } {
  const guns = gunStep(steps);
  if (!guns) return { short: 'no speed cost while stalled', long: 'none while stalled' };
  const lost = kph(guns.before) - kph(guns.step.speed);
  if (lost === 0) return { short: 'no speed cost', long: 'none' };
  const pct = `${percent(guns.step.factor)} speed`;
  return { short: pct, long: `${pct}, ${MINUS}${lost} km/h` };
}

export function powerChip(steps: SpeedStep[], v: Vehicle): PowerChip {
  const capacity = workingEngineCapacity(v);
  if (capacity === null) {
    return { text: 'No working engine', detail: 'No working engine: guns cost no speed.', over: false };
  }
  const draw = gunDraw(v);
  const over = draw > capacity;
  const balance = over ? `over by ${powerNumber(draw - capacity)}` : `${powerNumber(capacity - draw)} spare`;
  const cost = gunCost(steps);
  const detail = `Guns draw ${powerNumber(draw)} of ${powerNumber(capacity)} power, ${balance}. Cost: ${cost.long}.`;
  const text = `${powerNumber(draw)} / ${powerNumber(capacity)} power${over ? `, ${balance}` : ''}, ${cost.short}`;
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
    maxSpeedTip: speedTip(speedRows(weather, steps), speedNotes(w, me, steps)),
    manual: me.direct,
    clock: clockLabel(w.turn),
    resources: [
      {
        label: "M's",
        value: moneyNumber(p.money),
        balance: p.money,
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

const NEW_ISSUE_URL = "https://github.com/btseytlin/road-machiners/issues/new";

function issueFormUrl(template: string, fields: Record<string, string>): string {
  const url = new URL(NEW_ISSUE_URL);
  url.searchParams.set("template", template);
  for (const [id, value] of Object.entries(fields)) url.searchParams.set(id, value);
  return url.href;
}

export function versionLabel(): string {
  return `v${GAME_VERSION}`;
}

export function bugReportUrl(version: string): string {
  return issueFormUrl("bug.yml", { version });
}

export function featureRequestUrl(): string {
  return issueFormUrl("feature-request.yml", {});
}
