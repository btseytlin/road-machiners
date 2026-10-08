// Hover card: my weapons' hit odds on the hovered truck and its weapons' odds on me, with the causes of scatter.
// Every number comes from hitOdds, the same function the fire phase rolls against.

import { fireBlock, hitOdds, type HitOdds } from '../sim/combat';
import { playerVehicle } from '../sim/damage';
import { vehicleStats, type MountedWeapon } from '../sim/stats';
import type { Aim, Vehicle, World } from '../sim/types';
import { DEG } from '../sim/vec';
import { el } from './dom';
import { ammoText, blockText } from './weapons';

export type HitRow = { label: string; odds: HitOdds | null; text: string; cause: string | null; detail: string | null };
export type HitCardData = { name: string; mine: HitRow[]; theirs: HitRow[] };

function deg(r: number): string {
  return (Math.abs(r) / DEG).toFixed(1);
}

function detailLine(o: HitOdds): string {
  const extra = ([[o.causes.range, 'range'], [o.causes.crossing, 'crossing'], [o.causes.own, 'own speed'], [o.causes.recoil, 'recoil'], [o.causes.skill, 'perception'], [o.causes.weather, 'weather'], [o.causes.still, 'still target']] as const)
    .filter(([r]) => deg(r) !== '0.0')
    .map(([r, name]) => ` ${r < 0 ? '−' : '+'}${deg(r)}° ${name}`)
    .join('');
  return `${Math.round(o.chance * 100)}% land on aim, ${Math.round(o.distance)} m, shows ${o.width.toFixed(1)} m wide, scatter ${deg(o.causes.weapon)}° weapon${extra}`;
}

const MAIN_SHARE = 0.25;
const MAX_REASONS = 2;

function reasonLine(o: HitOdds, aim: Aim): string {
  const c = o.causes;
  const covered = aim !== 'body' && Math.round(o.damageChance * 100) < Math.round(o.chance * 100);
  const reasons: string[] = ([[c.range, 'far'], [c.crossing, 'target crossing fast'], [c.own, 'you are moving'], [c.recoil, 'gun kick'], [c.weather, 'bad weather'], [c.weapon, 'loose gun']] as const)
    .filter(([r]) => r / o.spread >= MAIN_SHARE)
    .sort((a, b) => b[0] - a[0])
    .slice(0, covered ? MAX_REASONS - 1 : MAX_REASONS)
    .map(([, name]) => name);
  if (covered) reasons.unshift('parts in the way');
  if (deg(c.still) !== '0.0') reasons.unshift('target is parked: easy');
  return reasons.length > 0 ? reasons.join(', ') : 'clear shot';
}

function row(world: World, shooter: Vehicle, mw: MountedWeapon, target: Vehicle, aim: Aim, name: string): HitRow {
  const block = fireBlock(world, shooter, mw, target);
  const label = `${name} ${ammoText(mw)}`;
  if (block !== null) return { label, odds: null, text: blockText(mw, block), cause: null, detail: null };
  const odds = hitOdds(world, shooter, mw, target, aim);
  return { label, odds, text: `${Math.round(odds.damageChance * 100)}%`, cause: reasonLine(odds, aim), detail: detailLine(odds) };
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
  return {
    name: it.name,
    mine: vehicleStats(world, me).weapons.map((mw, i) => row(world, me, mw, it, aimAt(me, mw, it), `[${i + 1}] ${mw.def.name}`)),
    theirs: vehicleStats(world, it).weapons.map((mw) => row(world, it, mw, me, aimAt(it, mw, me), mw.def.name)),
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
    const section = (title: string, rows: HitRow[]) => [
      el('div', { class: 'hc-head' }, title),
      ...(rows.length === 0 ? [el('div', { class: 'dim' }, 'No weapons')] : rows.flatMap((r) => [
        el('div', { class: 'hc-row', ...(r.detail ? { title: r.detail } : {}) }, el('span', {}, r.label), el('span', { class: r.odds ? 'hc-chance' : 'dim' }, r.text)),
        ...(r.cause ? [el('div', { class: 'hc-cause dim', title: r.detail ?? '' }, r.cause)] : []),
      ])),
    ];
    this.root.replaceChildren(...section('You → it', card.mine), ...section('It → you', card.theirs));
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  show(): void {
    if (this.root.childElementCount === 0) return this.hide();
    this.root.style.display = '';
  }
}
