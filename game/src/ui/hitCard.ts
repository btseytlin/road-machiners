// Hover card: my weapons' hit odds on the hovered truck and its weapons' odds on me, with the causes of scatter.
// Every number comes from hitOdds, the same function the fire phase rolls against.

import { fireBlock, hitOdds, type HitOdds } from '../sim/combat';
import { playerVehicle } from '../sim/damage';
import { vehicleStats, type MountedWeapon } from '../sim/stats';
import type { Aim, Vehicle, World } from '../sim/types';
import { shutDownTurnsLeft } from '../sim/utility';
import { DEG } from '../sim/vec';
import { concat, list, t, type Msg } from '../text/msg';
import { partName, vehicleTitle } from '../text/names';
import { el } from './dom';
import { ammoText, blockText } from './weapons';

// `cause` names the biggest reasons in plain words. `detail` holds every number, for a tooltip.
export type HitRow = { label: Msg; odds: HitOdds | null; text: Msg; cause: Msg | null; detail: Msg | null };
export type HitCardData = { name: Msg; shutDown: Msg | null; mine: HitRow[]; theirs: HitRow[] };

function deg(r: number): number {
  return Math.round((Math.abs(r) / DEG) * 10) / 10;
}

// "18 m, shows 4.1 m wide, scatter 2.0° weapon +1.1° crossing +0.4° own speed −0.3° gunnery".
// Extra causes that round to zero are left out.
function detailLine(o: HitOdds): Msg {
  const extra = ([[o.causes.range, 'range'], [o.causes.crossing, 'crossing'], [o.causes.own, 'own'], [o.causes.recoil, 'recoil'], [o.causes.skill, 'skill'], [o.causes.weather, 'weather'], [o.causes.smoke, 'smoke'], [o.causes.still, 'still']] as const)
    .filter(([r]) => deg(r) !== 0)
    .map(([r, name]) => t(r < 0 ? 'hit.causeLess' : 'hit.causeMore', { deg: deg(r), cause: t(`hit.cause.${name}`) }));
  const head = t('hit.detail', { pct: Math.round(o.chance * 100), m: Math.round(o.distance), wide: o.width, deg: deg(o.causes.weapon) });
  return concat([head, ...extra]);
}

const MAIN_SHARE = 0.25;
const MAX_REASONS = 2;

// The biggest reasons the chance is low, in plain words: "far, you are moving". A parked target reads as easy.
// An aimed part that other parts shield from this side leads.
function reasonLine(o: HitOdds, aim: Aim): Msg {
  const c = o.causes;
  const covered = aim !== 'body' && Math.round(o.damageChance * 100) < Math.round(o.chance * 100);
  const reasons: Msg[] = ([[c.range, 'far'], [c.crossing, 'crossing'], [c.own, 'moving'], [c.recoil, 'kick'], [c.weather, 'weather'], [c.weapon, 'loose']] as const)
    .filter(([r]) => r / o.spread >= MAIN_SHARE)
    .sort((a, b) => b[0] - a[0])
    .slice(0, covered ? MAX_REASONS - 1 : MAX_REASONS)
    .map(([, name]) => t(`hit.reason.${name}`));
  reasons.unshift(...leadReasons(c, covered));
  return reasons.length > 0 ? list(reasons) : t('hit.reason.clear');
}

function leadReasons(c: HitOdds['causes'], covered: boolean): Msg[] {
  const lead: [boolean, Msg][] = [[deg(c.still) !== 0, t('hit.reason.parked')], [c.smoke > 0, t('hit.reason.smoke')], [covered, t('hit.reason.covered')]];
  return lead.filter(([on]) => on).map(([, msg]) => msg);
}

function row(world: World, shooter: Vehicle, mw: MountedWeapon, target: Vehicle, aim: Aim, name: Msg): HitRow {
  const block = fireBlock(world, shooter, mw, target);
  const label = t('hit.label', { name, ammo: ammoText(mw) });
  if (block !== null) return { label, odds: null, text: blockText(mw, block), cause: null, detail: null };
  const odds = hitOdds(world, shooter, mw, target, aim);
  return { label, odds, text: t('hit.chance', { pct: Math.round(odds.damageChance * 100) }), cause: reasonLine(odds, aim), detail: detailLine(odds) };
}

function aimAt(shooter: Vehicle, mw: MountedWeapon, target: Vehicle): Aim {
  const order = shooter.weaponOrders[mw.part.id];
  return order && order.targetId === target.id ? order.aim : 'body';
}

export function hitCardRows(world: World, hoveredId: string): HitCardData | null {
  const me = playerVehicle(world);
  if (hoveredId === me.id) return null;
  const it = world.vehicles.find((v) => v.id === hoveredId);
  if (!it) throw new Error(`No vehicle ${hoveredId} to hover`);
  const left = shutDownTurnsLeft(world, it);
  return {
    name: vehicleTitle(world, it),
    shutDown: left > 0 ? t('hit.shutDown', { n: left }) : null,
    mine: vehicleStats(world, me).weapons.map((mw, i) => row(world, me, mw, it, aimAt(me, mw, it), t('hit.slot', { n: i + 1, gun: partName(mw.def.id) }))),
    theirs: vehicleStats(world, it).weapons.map((mw) => row(world, it, mw, me, aimAt(it, mw, me), partName(mw.def.id))),
  };
}

export class HitCard {
  private root = el('div', { class: 'hitcard' });

  constructor(container: HTMLElement) {
    this.root.style.display = 'none';
    container.append(this.root);
  }

  render(world: World, hoveredId: string | null): void {
    const card = hoveredId === null ? null : hitCardRows(world, hoveredId);
    if (!card) {
      this.root.replaceChildren();
      return this.hide();
    }
    const section = (title: Msg, rows: HitRow[]) => [
      el('div', { class: 'hc-head' }, title),
      ...(rows.length === 0 ? [el('div', { class: 'dim' }, t('hit.noWeapons'))] : rows.flatMap((r) => [
        el('div', { class: 'hc-row', ...(r.detail ? { title: r.detail } : {}) }, el('span', {}, r.label), el('span', { class: r.odds ? 'hc-chance' : 'dim' }, r.text)),
        ...(r.cause ? [el('div', { class: 'hc-cause dim', title: r.detail ?? undefined }, r.cause)] : []),
      ])),
    ];
    const shutDown = card.shutDown ? [el('div', { class: 'hc-cause' }, card.shutDown)] : [];
    this.root.replaceChildren(...shutDown, ...section(t('hit.mine'), card.mine), ...section(t('hit.theirs'), card.theirs));
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  show(): void {
    if (this.root.childElementCount === 0) return this.hide();
    this.root.style.display = '';
  }
}
