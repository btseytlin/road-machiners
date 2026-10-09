export type WakeMover = { x: number; z: number; vx: number; vz: number };
export type WakeState = { ox: number; oz: number; ux: number; uz: number };
export type WakeSpot = { x: number; z: number; height: number };

export const WAKE_LOOK = {
  reach: 4.5,
  minSpeed: 0.4,
  refSpeed: 6,
  push: 9,
  clingShare: 0.7,
  clingRate: 5,
  drag: 1.2,
  returnS: 5,
  maxOffset: 5,
  maxStepS: 0.1,
  top: 3,
  fadeHeight: 3,
  velocityS: 0.15,
  maxSpeed: 80,
};

export function newWake(): WakeState {
  return { ox: 0, oz: 0, ux: 0, uz: 0 };
}

export function stepWake(state: WakeState, home: WakeSpot, side: number, movers: readonly WakeMover[], dt: number): void {
  if (dt <= 0) return;
  const x = home.x + state.ox;
  const z = home.z + state.oz;
  const high = Math.min(1, Math.max(0, 1 - (home.height - WAKE_LOOK.top) / WAKE_LOOK.fadeHeight));
  for (const m of movers) if (high > 0) feel(state, { x, z }, side, m, high, dt);
  state.ux *= Math.exp(-WAKE_LOOK.drag * dt);
  state.uz *= Math.exp(-WAKE_LOOK.drag * dt);
  const settle = Math.exp(-dt / WAKE_LOOK.returnS);
  state.ox = (state.ox + state.ux * dt) * settle;
  state.oz = (state.oz + state.uz * dt) * settle;
  const away = Math.hypot(state.ox, state.oz);
  if (away > WAKE_LOOK.maxOffset) {
    state.ox *= WAKE_LOOK.maxOffset / away;
    state.oz *= WAKE_LOOK.maxOffset / away;
  }
}

function feel(state: WakeState, at: { x: number; z: number }, side: number, m: WakeMover, high: number, dt: number): void {
  const speed = Math.hypot(m.vx, m.vz);
  if (speed < WAKE_LOOK.minSpeed) return;
  const dx = at.x - m.x;
  const dz = at.z - m.z;
  const d = Math.hypot(dx, dz);
  if (d >= WAKE_LOOK.reach) return;
  const dirX = m.vx / speed;
  const dirZ = m.vz / speed;
  const along = dx * dirX + dz * dirZ;
  const across = -dx * dirZ + dz * dirX;
  const near = (1 - d / WAKE_LOOK.reach) ** 2 * high;
  const ahead = smooth01((along + WAKE_LOOK.reach) / (2 * WAKE_LOOK.reach));
  const sign = Math.abs(across) > 0.05 ? Math.sign(across) : side;
  const push = WAKE_LOOK.push * near * Math.min(1, speed / WAKE_LOOK.refSpeed) * (0.4 + 0.6 * ahead) * dt;
  state.ux += -dirZ * sign * push;
  state.uz += dirX * sign * push;
  const grip = Math.min(1, WAKE_LOOK.clingRate * near * (0.3 + 0.7 * (1 - ahead)) * dt);
  state.ux += (m.vx * WAKE_LOOK.clingShare - state.ux) * grip;
  state.uz += (m.vz * WAKE_LOOK.clingShare - state.uz) * grip;
}

function smooth01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

type Track = { x: number; z: number; vx: number; vz: number };

export class WakeTracker {
  private readonly tracks = new Map<string, Track>();
  private lastMs: number | null = null;

  update(positions: ReadonlyMap<string, { x: number; z: number }>, nowMs: number): { movers: WakeMover[]; dt: number } {
    const elapsed = this.lastMs === null ? 0 : Math.max(0, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    for (const id of this.tracks.keys()) if (!positions.has(id)) this.tracks.delete(id);
    for (const [id, p] of positions) this.follow(id, p, elapsed);
    return { movers: [...this.tracks.values()], dt: Math.min(elapsed, WAKE_LOOK.maxStepS) };
  }

  private follow(id: string, p: { x: number; z: number }, elapsed: number): void {
    const track = this.tracks.get(id);
    if (!track) {
      this.tracks.set(id, { x: p.x, z: p.z, vx: 0, vz: 0 });
      return;
    }
    if (elapsed > 0) {
      const vx = (p.x - track.x) / elapsed;
      const vz = (p.z - track.z) / elapsed;
      const jumped = Math.hypot(vx, vz) > WAKE_LOOK.maxSpeed;
      const blend = 1 - Math.exp(-elapsed / WAKE_LOOK.velocityS);
      track.vx = jumped ? 0 : track.vx + (vx - track.vx) * blend;
      track.vz = jumped ? 0 : track.vz + (vz - track.vz) * blend;
    }
    track.x = p.x;
    track.z = p.z;
  }
}
