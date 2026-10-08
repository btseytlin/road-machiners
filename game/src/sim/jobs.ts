// Parked jobs: work that needs the truck to stay parked for several turns. One rule for every driver.
// A job is cancelled on any turn its truck ends above parked speed, and its finished turns are lost.
// Business is an NPC's time at a site deal. A player truck with a drive order counts as moving too, since it still rolls slowly as it starts.

import { GOODS } from "../data/goods";
import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { STRIP } from "../data/salvage";
import { WORK } from "../data/utilities";
import { PERK_NUMBERS } from "../data/skills";
import { inCombat } from "./combat";
import { playerVehicle } from "./damage";
import { partValue } from "./wear";
import { corePart, coreParts, freeCells, goodsCount, isMounted, itemSize, mountedParts } from "./grid";
import { addGoods, applyRefitLayout, getRefitLayout, removeGoods, stowPart } from "./inventory";
import { makePart } from "./factory";
import { promisedParts } from "./patch";
import { isJunk, maxHp } from "./wear";
import { repairPlan, repairTurn } from "./repair";
import { practice, vehicleHasPerk } from "./progress";
import { finishTruckPickup } from "./salvage";
import { isSearchStalled, searchTurn } from "./search";
import { hasWorkingUtility } from "./utility";
import type { GridItem, Job, PartInstance, RefitJob, RefitPickup, Vehicle, World } from "./types";
import { getKnownSite } from "./npc-decisions";
import { canUseSite } from "./sites";
import { playerCommand } from "./world";

export { repairPlan };

export function isAutoPatch(job: Job | null): boolean {
  return job?.kind === "repair" && job.auto === true;
}

export function isBusy(v: Vehicle): boolean {
  return v.job !== null && !isAutoPatch(v.job);
}

export function isParkedForWork(world: World, v: Vehicle): boolean {
  if (v.speed > RULES.parkedSpeed) return false;
  return v.id !== world.player.vehicleId || v.order === null || v.order.kind === "brake";
}

export function dropLeftoverOrder(world: World, v: Vehicle): void {
  if (v.id === world.player.vehicleId && v.speed <= RULES.parkedSpeed) v.order = null;
}

export function startJob(world: World, v: Vehicle, job: Job): void {
  if (inCombat(world, v)) throw new Error("Not while in combat");
  if (isAutoPatch(v.job)) cancelJob(world, v);
  if (v.job)
    throw new Error(`${v.name} is already busy with a ${v.job.kind} job`);
  dropLeftoverOrder(world, v);
  if (!isParkedForWork(world, v)) throw new Error("Stop the truck first");
  v.job = job;
  world.events.push({
    t: "job",
    vehicle: v.id,
    job: { ...job },
    outcome: "started",
  });
}

export function startRepair(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    const v = playerVehicle(w);
    const plan = repairPlan(w, v, partId);
    if (plan.needed === 0) throw new Error("Already at the field repair cap");
    if (plan.parts === 0) throw new Error("No parts to patch with");
    startJob(w, v, {
      kind: "repair",
      partId,
      parts: plan.parts,
      turnsLeft: plan.turns,
      total: plan.turns,
    });
  });
}

export function startAutoRepair(world: World): void {
  if (!world.player.autoRepair || world.player.state !== "active") return;
  const v = playerVehicle(world);
  if (!canAutoPatch(world, v)) return;
  const worst = mountedParts(v)
    .filter((p) => !isJunk(p) && repairPlan(world, v, p.id).needed > 0)
    .sort((a, b) => patchRank(v, a) - patchRank(v, b) || a.hp / maxHp(a) - b.hp / maxHp(b))[0];
  if (!worst) return;
  const plan = repairPlan(world, v, worst.id, 1);
  startJob(world, v, {
    kind: "repair",
    partId: worst.id,
    parts: plan.parts,
    turnsLeft: plan.turns,
    total: plan.turns,
    auto: true,
  });
}

function patchRank(v: Vehicle, part: PartInstance): number {
  if (part.hp > 0) return 2;
  if (part === mountedParts(v, "engine")[0] || part === corePart(v, "transmission")) return 0;
  return coreParts(v, "wheel").includes(part) ? 1 : 2;
}

function freeParts(world: World, v: Vehicle): number {
  return (goodsCount(v).parts ?? 0) - promisedParts(world, v) - hauledParts(world, v);
}

function hauledParts(world: World, v: Vehicle): number {
  if (v.id !== world.player.vehicleId) return 0;
  return world.player.contracts.reduce((sum, c) => sum + (c.kind === "haul" && c.good === "parts" ? c.units : 0), 0);
}

function canAutoPatch(world: World, v: Vehicle): boolean {
  return !v.job && isParkedForWork(world, v) && freeParts(world, v) > 0 && !inCombat(world, v);
}

export function startStrip(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    const v = playerVehicle(w);
    if (!stripFits(v, findStripItem(v, partId))) throw new Error("No room for the stripped parts");
    startJob(w, v, {
      kind: "strip",
      partId,
      turnsLeft: STRIP.turns,
      total: STRIP.turns,
    });
  });
}

type PartItem = Extract<GridItem, { kind: "part" }>;

function findStripItem(v: Vehicle, partId: string): PartItem {
  const item = stripItem(v, partId);
  if (!item) throw new Error(`No spare part ${partId} on ${v.name}`);
  if (isMounted(v.chassisId, item)) throw new Error("Only a spare part can be stripped, not a mounted one");
  if (partDef(item.part.defId).kind === "core") throw new Error("A built-in part cannot be stripped");
  return item;
}

function stripItem(v: Vehicle, partId: string): PartItem | null {
  const item = v.items.find((it) => it.kind === "part" && it.part.id === partId);
  return item?.kind === "part" ? item : null;
}

export function stripYield(v: Vehicle, part: PartInstance): number {
  const share = hasWorkingUtility(v, "scraper") ? WORK.scraperStripShare : STRIP.yieldShare;
  return Math.max(1, Math.round((partValue(part) * share) / GOODS.parts.value));
}

function stripFits(v: Vehicle, item: PartItem): boolean {
  const size = itemSize(item);
  return freeCells(v) + size.w * size.h >= stripYield(v, item.part);
}

function isStripStalled(v: Vehicle, partId: string): boolean {
  const item = stripItem(v, partId);
  return !item || isMounted(v.chassisId, item) || !stripFits(v, item);
}

export function startWeld(world: World): World {
  return playerCommand(world, (w) => {
    const v = playerVehicle(w);
    if (!vehicleHasPerk(w, v, "welder")) throw new Error("Welding needs the Welder perk");
    if (!hasWeldScrap(v)) throw new Error(`Welding needs ${PERK_NUMBERS.welder.scrap} scrap metal`);
    if (!weldFits(v)) throw new Error("No room for the welded part");
    const turns = PERK_NUMBERS.welder.turns;
    startJob(w, v, { kind: "weld", turnsLeft: turns, total: turns });
  });
}

function hasWeldScrap(v: Vehicle): boolean {
  return (goodsCount(v).scrap ?? 0) >= PERK_NUMBERS.welder.scrap;
}

function weldFits(v: Vehicle): boolean {
  const def = partDef(PERK_NUMBERS.welder.part);
  return freeCells(v) + PERK_NUMBERS.welder.scrap >= def.w * def.h;
}

function weldTurn(world: World, v: Vehicle, job: Extract<Job, { kind: "weld" }>): boolean {
  job.turnsLeft = Math.max(0, job.turnsLeft - 1);
  if (job.turnsLeft > 0) return false;
  removeGoods(v, "scrap", PERK_NUMBERS.welder.scrap);
  if (!stowPart(world, v, makePart(world, PERK_NUMBERS.welder.part, 0))) throw new Error(`Welded part would not fit on ${v.name}`);
  return true;
}

export function advanceJobs(world: World): void {
  for (const v of world.vehicles) if (v.job) advanceJob(world, v, v.job);
}

function advanceJob(world: World, v: Vehicle, job: Job): void {
  if (!isParkedForWork(world, v) || inCombat(world, v)) return endJob(world, v, job, "cancelled");
  if (job.kind === "refit") return advanceRefit(world, v, job);
  if (isStalled(world, v, job)) return endJob(world, v, job, "cancelled");
  if (jobTurn(world, v, job)) endJob(world, v, job, "done");
}

function isStalled(world: World, v: Vehicle, job: Job): boolean {
  if (job.kind === "repair") return isRepairStalled(world, v, job);
  if (job.kind === "strip") return isStripStalled(v, job.partId);
  if (job.kind === "search") return isSearchStalled(world, v, job);
  return isSiteWorkStalled(v, job);
}

// A weld needs its scrap and room, and business needs the truck on its site's pad.
function isSiteWorkStalled(v: Vehicle, job: Job): boolean {
  if (job.kind === "business") return !canUseSite(v.pos, getKnownSite(job.siteId));
  return job.kind === "weld" && (!hasWeldScrap(v) || !weldFits(v));
}

function jobTurn(world: World, v: Vehicle, job: Job): boolean {
  if (job.kind === "repair") return repairTurn(world, v, job);
  if (job.kind === "search") return searchTurn(world, v, job);
  if (job.kind === "strip") return stripTurn(world, v, job);
  if (job.kind === "weld") return weldTurn(world, v, job);
  if (job.kind === "business") return businessTurn(job);
  throw new Error(`Unhandled job kind ${job.kind}`);
}

// The job carries no deal. The NPC's goal resolver runs the deal on the turn this returns true.
function businessTurn(job: Extract<Job, { kind: "business" }>): boolean {
  job.turnsLeft = Math.max(0, job.turnsLeft - 1);
  return job.turnsLeft === 0;
}

function stripTurn(world: World, v: Vehicle, job: Extract<Job, { kind: "strip" }>): boolean {
  job.turnsLeft = Math.max(0, job.turnsLeft - 1);
  if (job.turnsLeft > 0) return false;
  finishStrip(world, v, job.partId);
  return true;
}

function finishStrip(world: World, v: Vehicle, partId: string): void {
  const part = findStripItem(v, partId).part;
  const units = stripYield(v, part);
  v.items = v.items.filter((it) => !(it.kind === "part" && it.part.id === partId));
  const added = addGoods(world, v, "parts", units);
  if (added < units) throw new Error(`Stripped parts would not fit on ${v.name}`);
}

function isRepairStalled(world: World, v: Vehicle, job: Extract<Job, { kind: "repair" }>): boolean {
  const part = mountedParts(v).find((p) => p.id === job.partId);
  if (!part || isJunk(part) || repairPlan(world, v, job.partId, job.parts).parts === 0) return true;
  return job.auto === true && freeParts(world, v) < job.parts;
}

function advanceRefit(world: World, v: Vehicle, job: RefitJob): void {
  const result = getRefitLayout(world, v, job);
  if (result.error !== null) return endJob(world, v, job, 'cancelled');
  job.turnsLeft -= 1;
  if (job.turnsLeft > 0) return;
  applyRefitLayout(world, v, result.items);
  if (job.pickup) takePickup(world, v, job.pickup);
  endJob(world, v, job, 'done');
}

function takePickup(world: World, v: Vehicle, pickup: RefitPickup): void {
  if (pickup.from === 'truck') return finishTruckPickup(world, v, pickup);
  const stock = world.salvage.find((entry) => entry.id === pickup.stockId);
  const part = stock?.parts.find((entry) => entry.id === pickup.partId);
  if (!stock || !part) throw new Error('Refit stock part disappeared after validation');
  stock.parts = stock.parts.filter((entry) => entry.id !== pickup.partId);
}

export function cancelJob(world: World, v: Vehicle): void {
  if (v.job) endJob(world, v, v.job, "cancelled");
}

export function cancelRefit(world: World): World {
  return playerCommand(world, (w) => {
    const v = playerVehicle(w);
    if (v.job?.kind !== "refit") throw new Error("No refit to cancel");
    cancelJob(w, v);
  });
}

function endJob(
  world: World,
  v: Vehicle,
  job: Job,
  outcome: "done" | "cancelled",
): void {
  v.job = null;
  world.events.push({ t: "job", vehicle: v.id, job: { ...job }, outcome });
  if (outcome === "done") practiceFieldJob(world, v, job);
}

function practiceFieldJob(world: World, v: Vehicle, job: Job): void {
  if (v.id !== world.player.vehicleId || job.kind !== "repair") return;
  practice(world, "fieldJob", job.total, null, job.partId);
}
