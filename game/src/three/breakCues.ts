// When each part break of a turn plays. A part break belongs to the shot whose round dealt its last damage, so it can
// play as that round lands. Breaks with no round, such as a collision's, wait for the end of the shot band.
// Nothing here changes game rules.

import type { GameEvent, GridItem, ShotRound } from "../sim/types";

export type PartBreak = { vehicle: string; part: string };
export type ShotLike = Extract<GameEvent, { t: "shot" }>;
export type BreakRound = { brk: PartBreak; owner: ShotLike | null; round: number | null };

const damageTo = (r: ShotRound, brk: PartBreak): number => {
  const hits = [...(r.struck === brk.vehicle ? r.hits : []), ...r.blast.filter((b) => b.vehicle === brk.vehicle).flatMap((b) => b.hits)];
  return hits.filter((h) => h.part === brk.part).reduce((sum, h) => sum + h.damage, 0);
};

const DAMAGING = new Set<GameEvent["t"]>(["shot", "collision", "claymore", "claymoreCookOff", "caltrops", "lineTorn"]);

export function breakRounds(events: GameEvent[]): BreakRound[] {
  const out: BreakRound[] = [];
  events.forEach((e, i) => {
    if (e.t !== "partDisabled") return;
    const brk = { vehicle: e.vehicle, part: e.part };
    const owner = events.slice(i + 1).find((x) => DAMAGING.has(x.t));
    if (!owner || owner.t !== "shot") return void out.push({ brk, owner: null, round: null });
    const round = owner.rounds.map((r) => damageTo(r, brk) > 0).lastIndexOf(true);
    if (round < 0) throw new Error(`Part ${brk.part} of ${brk.vehicle} was disabled but no round of the following ${owner.t} damaged it`);
    out.push({ brk, owner, round });
  });
  return out;
}

export class BreakCues {
  private readonly pending: BreakRound[];
  private readonly played = new Map<string, Set<string>>();

  constructor(events: GameEvent[]) {
    this.pending = breakRounds(events);
  }

  ofRound(owner: ShotLike, round: number): PartBreak[] {
    return this.take((b) => b.owner === owner && b.round === round);
  }

  rest(): PartBreak[] {
    return this.take(() => true);
  }

  shown(vehicleId: string): ReadonlySet<string> {
    return this.played.get(vehicleId) ?? new Set();
  }

  private take(fits: (b: BreakRound) => boolean): PartBreak[] {
    const taken = this.pending.filter(fits);
    for (const b of taken) {
      this.pending.splice(this.pending.indexOf(b), 1);
      const set = this.played.get(b.brk.vehicle) ?? new Set<string>();
      set.add(b.brk.part);
      this.played.set(b.brk.vehicle, set);
    }
    return taken.map((b) => b.brk);
  }
}

export function shownItems(before: GridItem[], after: GridItem[], shown: ReadonlySet<string>): GridItem[] {
  if (shown.size === 0) return before;
  return before.map((it) => {
    if (it.kind !== "part" || !shown.has(it.part.id)) return it;
    const now = after.find((x) => x.kind === "part" && x.part.id === it.part.id);
    return now && now.kind === "part" ? { ...it, part: now.part } : it;
  });
}
