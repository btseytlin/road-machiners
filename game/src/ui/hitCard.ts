import { chanceSteps, fireBlock, hitOdds, type ChanceStep, type HitOdds } from '../sim/combat';
import { playerVehicle } from '../sim/damage';
import { vehicleStats, type MountedWeapon } from '../sim/stats';
import type { Aim, Vehicle, World } from '../sim/types';
import { el } from './dom';
import { ammoText, blockText } from './weapons';

export type TipRow = { name: string; delta: number };
export type ChanceTip = { base: number; rows: TipRow[] };
export type HitRow = { key: number | null; name: string; ammo: string; odds: HitOdds | null; text: string; tip: ChanceTip | null };
export type HitCardData = { name: string; mine: HitRow[]; theirs: HitRow[] };

type CauseNames = Record<ChanceStep['cause'], string>;

const SHARED_NAMES = { weapon: 'Loose gun', range: 'Far', recoil: 'Gun kick', skill: 'Driver perception', weather: 'Bad weather', smoke: 'Smoke' };

const MY_NAMES: CauseNames = { ...SHARED_NAMES, crossing: 'Target crossing fast', own: 'You are moving', still: 'Target is parked' };
const THEIR_NAMES: CauseNames = { ...SHARED_NAMES, crossing: 'You are crossing fast', own: 'It is moving', still: 'You are parked' };

function chanceTip(world: World, shooter: Vehicle, mw: MountedWeapon, target: Vehicle, aim: Aim, names: CauseNames): ChanceTip {
  const steps = chanceSteps(world, shooter, mw, target, aim);
  const shown = steps.map((s) => Math.round(s.chance * 100));
  const rows = steps.slice(1).map((s, i) => ({ name: names[s.cause], delta: shown[i + 1] - shown[i] }));
  return { base: shown[0], rows: rows.filter((r) => r.delta !== 0) };
}

function row(world: World, shooter: Vehicle, mw: MountedWeapon, target: Vehicle, aim: Aim, key: number | null, names: CauseNames): HitRow {
  const gun = { key, name: mw.def.name, ammo: ammoText(mw) };
  const block = fireBlock(world, shooter, mw, target);
  if (block !== null) return { ...gun, odds: null, text: blockText(mw, block), tip: null };
  const odds = hitOdds(world, shooter, mw, target, aim);
  return { ...gun, odds, text: `${Math.round(odds.damageChance * 100)}%`, tip: chanceTip(world, shooter, mw, target, aim, names) };
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
    mine: vehicleStats(world, me).weapons.map((mw, i) => row(world, me, mw, it, aimAt(me, mw, it), i + 1, MY_NAMES)),
    theirs: vehicleStats(world, it).weapons.map((mw) => row(world, it, mw, me, aimAt(it, mw, me), null, THEIR_NAMES)),
  };
}

const HIGH_CHANCE = 50;

function signed(delta: number): string {
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)}%`;
}

function tipOf(tip: ChanceTip): HTMLElement {
  return el('span', { class: 'tooltip hc-tip', role: 'tooltip' },
    el('span', { class: 'base' }, 'Base'),
    el('span', { class: 'v base' }, `${tip.base}%`),
    ...tip.rows.flatMap((r) => [el('span', {}, r.name), el('span', { class: `v ${r.delta > 0 ? 'up' : 'down'}` }, signed(r.delta))]),
  );
}

function chanceOf(r: HitRow, theirs: boolean): HTMLElement {
  if (!r.odds || !r.tip) return el('span', { class: 'hc-pct blocked', title: r.text }, r.text);
  const percent = Math.round(r.odds.damageChance * 100);
  const tone = percent === 0 ? 'zero' : percent >= HIGH_CHANCE ? 'high' : '';
  return el('span', { class: `hc-pct ${theirs ? 'theirs' : 'mine'} ${tone}`.trim(), tabindex: 0 }, r.text, tipOf(r.tip));
}

function gunRow(r: HitRow, theirs: boolean): HTMLElement {
  const name = el('span', { class: 'hc-gun', title: `${r.name} ${r.ammo}` }, ...(r.key === null ? [] : [el('span', { class: 'hc-key' }, String(r.key))]), r.name);
  return el('div', { class: `hc-row${r.odds ? '' : ' blocked'}` }, name, chanceOf(r, theirs));
}

function well(title: string, rows: HitRow[], theirs: boolean): HTMLElement {
  return el('div', { class: `hc-well${theirs ? ' theirs' : ''}` },
    el('div', { class: 'hc-cap' }, title),
    ...(rows.length === 0 ? [el('div', { class: 'hc-none' }, '–')] : rows.map((r) => gunRow(r, theirs))),
  );
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
    this.root.replaceChildren(well('You', card.mine, false), well('Them', card.theirs, true));
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  show(): void {
    if (this.root.childElementCount === 0) return this.hide();
    this.root.style.display = '';
  }
}
