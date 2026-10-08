// First-time tips for driving and the horn, and a farewell once the player heads out. Seen tips stay in browser storage across saves.

import { isKnockedOut } from "../sim/defeat";
import { playerVehicle } from "../sim/damage";
import { goodsCount, isMounted, mountedParts } from "../sim/grid";
import { openingStockOf } from "../sim/opening";
import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { repairPlan } from "../sim/repair";
import { canReachSalvage, hasSalvage } from "../sim/salvage";
import type { SalvageStock, World } from "../sim/types";
import { vehicleStats } from "../sim/stats";
import { playerSees } from "../sim/vision";
import { dist } from "../sim/vec";
import { playerCanAct, hostileToPlayer, startPose } from "../sim/world";
import { t } from "../text/msg";
import { el, panel } from "./dom";

const TIPS_KEY = "roam.tips";

export type OpeningStep = "wreck" | "search" | "loot" | "patch" | "install";
export type TipId = OpeningStep | "waypoint" | "drive" | "autoStop" | "stop" | "stopAt" | "manual" | "zones" | "aim" | "honk" | "farewell";

// A tip's words live in src/text/ as hint.<id>.
type Tip = {
  id: TipId;
  opening?: true;
  after?: TipId; // shows only once this tip is seen
  seenWhenOver?: true; // counts as seen once its moment ends while it shows
  when: (w: World, auto: boolean, o: OpeningState) => boolean; // auto: turns follow each other without a key press
  done: (w: World, o: OpeningState) => boolean;
};

const FAREWELL_DISTANCE = 80;
const spawn = startPose().pos;

const npcInSight = (w: World): boolean =>
  w.vehicles.some((v) => v.brain && !isKnockedOut(v) && playerSees(w, v.pos));

const hostileInSight = (w: World): boolean =>
  w.vehicles.some((v) => v.brain && !isKnockedOut(v) && hostileToPlayer(w, v) && playerSees(w, v.pos));

const moving = (w: World): boolean => playerVehicle(w).speed > RULES.parkedSpeed;

const hasWaypoint = (w: World): boolean => {
  const kind = playerVehicle(w).order?.kind;
  return kind === "through" || kind === "stopAt";
};

type OpeningState = { stock: SalvageStock | null; step: OpeningStep | null };

const searchedOpening = (w: World, { stock }: OpeningState): boolean => stock !== null && w.player.scavenged.includes(stock.id);

const inOpeningReach = (w: World, { stock }: OpeningState): boolean => stock !== null && canReachSalvage(playerVehicle(w), stock);

const engineNeedsPatch = (w: World): boolean => {
  const me = playerVehicle(w);
  const engine = mountedParts(me).find((p) => partDef(p.defId).kind === "engine");
  return engine !== undefined && repairPlan(w, me, engine.id).needed > 0;
};

const cageMounted = (w: World): boolean => mountedParts(playerVehicle(w)).some((p) => p.defId === "cage");

const holdsLooseCage = (w: World): boolean => {
  const me = playerVehicle(w);
  return me.items.some((it) => it.kind === "part" && it.part.defId === "cage" && !isMounted(me.chassisId, it));
};

export function openingStep(w: World): OpeningStep | null {
  return openingState(w).step;
}

function openingState(w: World): OpeningState {
  const stock = openingStockOf(w);
  if (!stock) return { stock, step: null };
  return { stock, step: w.player.scavenged.includes(stock.id) ? stepAfterSearch(w, stock) : stepBeforeSearch(w, stock) };
}

function stepBeforeSearch(w: World, stock: SalvageStock): OpeningStep | null {
  if (!hasSalvage(stock)) return null;
  return canReachSalvage(playerVehicle(w), stock) ? "search" : "wreck";
}

function stepAfterSearch(w: World, stock: SalvageStock): OpeningStep | null {
  if (hasSalvage(stock) && canReachSalvage(playerVehicle(w), stock)) return "loot";
  if (patchDue(w)) return "patch";
  return installDue(w) ? "install" : null;
}

const patchDue = (w: World): boolean => engineNeedsPatch(w) && (goodsCount(playerVehicle(w)).parts ?? 0) > 0;

const installDue = (w: World): boolean => holdsLooseCage(w) && !cageMounted(w);

const openingTip = (id: OpeningStep, done: (w: World, o: OpeningState) => boolean): Tip => ({
  id,
  opening: true,
  when: (w, _auto, o) => !playerVehicle(w).direct && o.step === id,
  done,
});

const TIPS: readonly Tip[] = [
  openingTip(
    "wreck",
    (w, o) => inOpeningReach(w, o) || searchedOpening(w, o),
  ),
  openingTip("search", searchedOpening),
  openingTip(
    "loot",
    (w, o) => o.stock !== null && searchedOpening(w, o) && !hasSalvage(o.stock),
  ),
  openingTip(
    "patch",
    (w, o) => o.stock !== null && !engineNeedsPatch(w),
  ),
  openingTip(
    "install",
    (w, o) => o.stock !== null && cageMounted(w),
  ),
  {
    id: "waypoint",
    when: (w) => !playerVehicle(w).direct,
    done: (w) => hasWaypoint(w),
  },
  {
    id: "drive",
    after: "waypoint",
    when: (w) => !playerVehicle(w).direct && hasWaypoint(w),
    done: moving,
  },
  {
    id: "autoStop",
    after: "drive",
    when: (_w, auto) => auto,
    done: () => false,
    seenWhenOver: true,
  },
  {
    id: "stop",
    after: "drive",
    when: moving,
    done: (w) => playerVehicle(w).order?.kind === "brake",
  },
  {
    id: "stopAt",
    after: "stop",
    when: (w) => !playerVehicle(w).direct,
    done: (w) => playerVehicle(w).order?.kind === "stopAt",
  },
  {
    id: "manual",
    after: "stopAt",
    when: (w) => !playerVehicle(w).direct,
    done: (w) => playerVehicle(w).direct,
  },
  {
    id: "zones",
    when: (w) => playerVehicle(w).direct,
    done: () => false,
  },
  {
    id: "aim",
    when: (w) => vehicleStats(w, playerVehicle(w)).weapons.length > 0 && hostileInSight(w),
    done: (w) => Object.values(playerVehicle(w).weaponOrders).some((o) => o.aim !== "body"),
  },
  {
    id: "honk",
    when: npcInSight,
    done: (w) => w.events.some((e) => e.t === "honk" && e.vehicle === w.player.vehicleId),
  },
  {
    id: "farewell",
    after: "honk",
    when: (w) => dist(playerVehicle(w).pos, spawn) >= FAREWELL_DISTANCE,
    done: () => false,
  },
];

const openingLive = (o: OpeningState, seen: ReadonlySet<TipId>): boolean => o.step !== null && !seen.has(o.step);

export function doneTips(world: World, seen: ReadonlySet<TipId>): TipId[] {
  const o = openingState(world);
  const live = openingLive(o, seen);
  return TIPS.filter((t) => (t.opening || !live) && t.done(world, o)).map((t) => t.id);
}

export function tipToShow(world: World, auto: boolean, seen: ReadonlySet<TipId>, shown: TipId | null): TipId | null {
  if (!playerCanAct(world)) return null;
  const o = openingState(world);
  const live = openingLive(o, seen);
  const open = TIPS.filter((t) => (t.opening || !live) && !seen.has(t.id) && (!t.after || seen.has(t.after)) && t.when(world, auto, o));
  return (open.find((t) => t.id === shown) ?? open[0])?.id ?? null;
}

export function clearTips(storage: Storage): void {
  storage.removeItem(TIPS_KEY);
}

function readSeen(storage: Storage): Set<TipId> {
  const raw = storage.getItem(TIPS_KEY);
  if (raw === null) return new Set();
  const ids: unknown = JSON.parse(raw);
  const known = new Set<string>(TIPS.map((t) => t.id));
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && known.has(id)))
    throw new Error(`Stored tips are not a list of tip ids: ${raw}`);
  return new Set(ids as TipId[]);
}

export class Tips {
  private readonly box = panel("tip");
  private readonly seen: Set<TipId>;
  private shown: TipId | null = null;
  private moment: { world: World; auto: boolean } | null = null;

  constructor(private readonly storage: Storage) {
    this.seen = readSeen(storage);
    this.box.style.display = "none";
  }

  update(world: World, auto: boolean): void {
    this.moment = { world, auto };
    for (const id of doneTips(world, this.seen)) this.markSeen(id);
    const next = tipToShow(world, auto, this.seen, this.shown);
    if (next === this.shown) return;
    this.passShown();
    this.shown = next;
    this.render();
  }

  private passShown(): void {
    const tip = TIPS.find((t) => t.id === this.shown);
    if (tip?.seenWhenOver) this.markSeen(tip.id);
  }

  private markSeen(id: TipId): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.storage.setItem(TIPS_KEY, JSON.stringify([...this.seen]));
  }

  private close(): void {
    if (!this.shown || !this.moment) throw new Error("Closed a tip that was never shown");
    this.markSeen(this.shown);
    this.shown = null;
    this.render();
    this.update(this.moment.world, this.moment.auto);
  }

  private render(): void {
    const tip = TIPS.find((t) => t.id === this.shown);
    this.box.style.display = tip ? "" : "none";
    if (!tip) return;
    this.box.classList.toggle("opening-tip", tip.opening === true);
    this.box.replaceChildren(
      el("span", {}, t(`hint.${tip.id}`)),
      el("button", { class: "tip-close", title: t("menu.close"), onclick: () => this.close() }, t("hint.closeMark")),
    );
  }
}
