import { readState, updateState } from './state';
import type { Ctx, VisualWaiver } from './types';

export const WAIVER_REASON_LIMIT = 300;

export function visualWaiverOf(ctx: Ctx, issue: number): VisualWaiver | null {
  return readState(ctx.statePath).visualWaivers[String(issue)] ?? null;
}

// Only the committee command writes it, and the inbox has checked the member by then. The agent's own `visual: false` never reaches here.
export function recordWaiver(ctx: Ctx, issue: number, by: string, byName: string | null, reason: string): VisualWaiver {
  const waiver = { by, byName, reason: reason.trim().slice(0, WAIVER_REASON_LIMIT), at: ctx.now().toISOString() };
  updateState(ctx.statePath, (state) => ({ ...state, visualWaivers: { ...state.visualWaivers, [String(issue)]: waiver } }));
  return waiver;
}

// A waiver covers one approval post. After it, a rebuilt card needs its evidence again, unless the committee waives again.
export function consumeWaiver(ctx: Ctx, issue: number): void {
  updateState(ctx.statePath, (state) => ({ ...state, visualWaivers: Object.fromEntries(Object.entries(state.visualWaivers).filter(([key]) => key !== String(issue))) }));
}

export function waiverNotice(waiver: VisualWaiver): string {
  return `${waiver.byName ?? waiver.by} (Telegram ${waiver.by}) waived the screenshot on ${waiver.at}. Reason: ${waiver.reason}`;
}
