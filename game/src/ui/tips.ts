// First-time tips for driving and the horn, and a farewell once the player heads out. A tip shows while its moment lasts, one at a time. It goes away for good
// once the player closes it or does what it says. Seen tips stay in browser storage across saves, and a new game clears them.

import { isKnockedOut } from "../sim/defeat";
import { playerVehicle } from "../sim/damage";
import type { World } from "../sim/types";
import { vehicleStats } from "../sim/stats";
import { playerSees } from "../sim/vision";
import { dist } from "../sim/vec";
import { playerCanAct, hostileToPlayer, startPose } from "../sim/world";
import { el, panel } from "./dom";

const TIPS_KEY = "roam.tips";

export type TipId = "waypoint" | "drive" | "autoStop" | "stop" | "stopAt" | "manual" | "zones" | "aim" | "honk" | "farewell";

type Tip = {
  id: TipId;
  text: string;
  after?: TipId;
  seenWhenOver?: true;
  when: (w: World, auto: boolean) => boolean;
  done: (w: World) => boolean;
};

const FAREWELL_DISTANCE = 80;
const spawn = startPose().pos;

const npcInSight = (w: World): boolean =>
  w.vehicles.some((v) => v.brain && !isKnockedOut(v) && playerSees(w, v.pos));

const hostileInSight = (w: World): boolean =>
  w.vehicles.some((v) => v.brain && !isKnockedOut(v) && hostileToPlayer(w, v) && playerSees(w, v.pos));

const hasWaypoint = (w: World): boolean => {
  const kind = playerVehicle(w).order?.kind;
  return kind === "through" || kind === "stopAt";
};

const TIPS: readonly Tip[] = [
  {
    id: "waypoint",
    text: "Click the ground to set a waypoint.",
    when: (w) => !playerVehicle(w).direct,
    done: (w) => hasWaypoint(w),
  },
  {
    id: "drive",
    text: "[Space] to drive to the waypoint.",
    after: "waypoint",
    when: (w) => !playerVehicle(w).direct && hasWaypoint(w),
    done: (w) => playerVehicle(w).speed > 0,
  },
  {
    id: "autoStop",
    text: "[Space] to stop automatic travel.",
    after: "drive",
    when: (_w, auto) => auto,
    done: () => false,
    seenWhenOver: true,
  },
  {
    id: "stop",
    text: "Click your truck to stop.",
    after: "drive",
    when: (w) => playerVehicle(w).speed > 0,
    done: (w) => playerVehicle(w).order?.kind === "brake",
  },
  {
    id: "stopAt",
    text: "[Shift]-click to set a waypoint your truck stops at. Click a waypoint to switch it.",
    after: "stop",
    when: (w) => !playerVehicle(w).direct,
    done: (w) => playerVehicle(w).order?.kind === "stopAt",
  },
  {
    id: "manual",
    text: "[R] to drive in manual mode.",
    after: "stopAt",
    when: (w) => !playerVehicle(w).direct,
    done: (w) => playerVehicle(w).direct,
  },
  {
    id: "zones",
    text: "Manual mode: click a zone to drive. Green speeds up. Yellow holds speed. Red slows down.",
    when: (w) => playerVehicle(w).direct,
    done: () => false,
  },
  {
    id: "aim",
    text: "Click an enemy truck, then click one of its parts to aim your guns at it.",
    when: (w) => vehicleStats(w, playerVehicle(w)).weapons.length > 0 && hostileInSight(w),
    done: (w) => Object.values(playerVehicle(w).weaponOrders).some((o) => o.aim !== "body"),
  },
  {
    id: "honk",
    text: "[H] to honk.",
    when: npcInSight,
    done: (w) => w.events.some((e) => e.t === "honk" && e.vehicle === w.player.vehicleId),
  },
  {
    id: "farewell",
    text: "That's it, good luck.",
    after: "honk",
    when: (w) => dist(playerVehicle(w).pos, spawn) >= FAREWELL_DISTANCE,
    done: () => false,
  },
];

export function doneTips(world: World): TipId[] {
  return TIPS.filter((t) => t.done(world)).map((t) => t.id);
}

export function tipToShow(world: World, auto: boolean, seen: ReadonlySet<TipId>, shown: TipId | null): TipId | null {
  if (!playerCanAct(world)) return null;
  const open = TIPS.filter((t) => !seen.has(t.id) && (!t.after || seen.has(t.after)) && t.when(world, auto));
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
    for (const id of doneTips(world)) this.markSeen(id);
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
    this.box.replaceChildren(
      el("span", {}, tip.text),
      el("button", { class: "tip-close", title: "Close", onclick: () => this.close() }, "×"),
    );
  }
}
