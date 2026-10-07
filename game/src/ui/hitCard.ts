// Hover card: my weapons' hit odds on the hovered truck and its weapons' odds on me, with the causes of scatter.
// Utilities that fire at trucks, like the harpoon, follow the guns. Every number comes from hitOdds, the same function
// the fire phase and the activation step roll against.

import { partDef, type UtilityDef } from '../data/parts';
import { fireBlock, hitOdds, type HitOdds } from '../sim/combat';
import { playerVehicle } from '../sim/damage';
import { vehicleStats, type MountedWeapon } from '../sim/stats';
import type { Aim, PartInstance, Vehicle, World } from '../sim/types';
import { chargedParts, harpoonWait, orderKindOf, shutDownTurnsLeft } from '../sim/utility';
import { DEG } from '../sim/vec';
import { wornDef } from '../sim/wear';
import { el } from './dom';
import { ammoText, blockText, utilityBlockText, utilitySlots, UTILITY_SLOTS } from './weapons';

// `cause` names the biggest reasons in plain words. `detail` holds every number, for a tooltip.
export type HitRow = { label: string; odds: HitOdds | null; text: string; cause: string | null; detail: string | null };
// shutDown: the shut-down turns the hovered truck still has ahead, as words, or null while it runs.
export type HitCardData = { name: string; shutDown: string | null; mine: HitRow[]; theirs: HitRow[] };

function deg(r: number): string {
  return (Math.abs(r) / DEG).toFixed(1);
}

// "18 m, shows 4.1 m wide, scatter 2.0° weapon +1.1° crossing +0.4° own speed −0.3° gunnery".
// Extra causes that round to zero are left out.
function detailLine(o: HitOdds): string {
  const extra = ([[o.causes.range, 'range'], [o.causes.crossing, 'crossing'], [o.causes.own, 'own speed'], [o.causes.recoil, 'recoil'], [o.causes.skill, 'perception'], [o.causes.weather, 'weather'], [o.causes.smoke, 'smoke'], [o.causes.still, 'still target']] as const)
    .filter(([r]) => deg(r) !== '0.0')
    .map(([r, name]) => ` ${r < 0 ? '−' : '+'}${deg(r)}° ${name}`)
    .join('');
  return `${Math.round(o.chance * 100)}% land on aim, ${Math.round(o.distance)} m, shows ${o.width.toFixed(1)} m wide, scatter ${deg(o.causes.weapon)}° weapon${extra}`;
}

// A cause is a main reason when it makes up at least this share of the scatter. Smaller ones are noise to a player.
const MAIN_SHARE = 0.25;
const MAX_REASONS = 2;

// The biggest reasons the chance is low, in plain words: "far, you are moving". A parked target reads as easy.
// Smoke between the trucks and an aimed part that other parts shield from this side lead.
function reasonLine(o: HitOdds, aim: Aim): string {
  const c = o.causes;
  const covered = aim !== 'body' && Math.round(o.damageChance * 100) < Math.round(o.chance * 100);
  const reasons: string[] = ([[c.range, 'far'], [c.crossing, 'target crossing fast'], [c.own, 'you are moving'], [c.recoil, 'gun kick'], [c.weather, 'bad weather'], [c.weapon, 'loose gun']] as const)
    .filter(([r]) => r / o.spread >= MAIN_SHARE)
    .sort((a, b) => b[0] - a[0])
    .slice(0, covered ? MAX_REASONS - 1 : MAX_REASONS)
    .map(([, name]) => name);
  reasons.unshift(...leadReasons(c, covered));
  return reasons.length > 0 ? reasons.join(', ') : 'clear shot';
}

// Reasons named whatever their share: a parked target, smoke on the line and parts in the way.
function leadReasons(c: HitOdds['causes'], covered: boolean): string[] {
  const lead: [boolean, string][] = [[deg(c.still) !== '0.0', 'target is parked: easy'], [c.smoke > 0, 'smoke'], [covered, 'parts in the way']];
  return lead.filter(([on]) => on).map(([, name]) => name);
}

function row(world: World, shooter: Vehicle, mw: MountedWeapon, target: Vehicle, aim: Aim, name: string): HitRow {
  const block = fireBlock(world, shooter, mw, target);
  const label = `${name} ${ammoText(mw)}`;
  if (block !== null) return { label, odds: null, text: blockText(mw, block), cause: null, detail: null };
  const odds = hitOdds(world, shooter, mw, target, aim);
  return { label, odds, text: `${Math.round(odds.damageChance * 100)}%`, cause: reasonLine(odds, aim), detail: detailLine(odds) };
}

// A harpoon's row: its chance to land on the target, or why it cannot fire now. The chance is the round's.
function utilityRow(world: World, shooter: Vehicle, part: PartInstance, target: Vehicle, name: string): HitRow {
  const block = harpoonWait(world, shooter, part, target);
  if (block !== null) return { label: name, odds: null, text: utilityBlockText(part, block), cause: null, detail: null };
  const order = shooter.utilityOrders[part.id];
  const aim = order?.kind === 'truck' && order.targetId === target.id ? order.aim : 'body';
  const odds = hitOdds(world, shooter, { def: wornDef<UtilityDef>(part) }, target, aim);
  return { label: name, odds, text: `${Math.round(odds.chance * 100)}%`, cause: reasonLine(odds, aim), detail: detailLine(odds) };
}

// The mounted utilities that fire at trucks, in slot order.
function truckUtilities(v: Vehicle): PartInstance[] {
  return chargedParts(v).filter((p) => orderKindOf(p) === 'truck');
}

// "[5] Harpoon" for a utility on a key of the player's utility row.
function slotName(world: World, part: PartInstance): string {
  const slot = utilitySlots(world).indexOf(part);
  const name = partDef(part.defId).name;
  return slot < 0 ? name : `[${slot + 1 + UTILITY_SLOTS}] ${name}`;
}

// A weapon's aim at a target: its order's aim when the order is at that target, else a body shot.
function aimAt(shooter: Vehicle, mw: MountedWeapon, target: Vehicle): Aim {
  const order = shooter.weaponOrders[mw.part.id];
  return order && order.targetId === target.id ? order.aim : 'body';
}

// The card for the hovered truck, or null for my own truck.
export function hitCardRows(world: World, hoveredId: string): HitCardData | null {
  const me = playerVehicle(world);
  if (hoveredId === me.id) return null;
  const it = world.vehicles.find((v) => v.id === hoveredId);
  if (!it) throw new Error(`No vehicle ${hoveredId} to hover`);
  const left = shutDownTurnsLeft(world, it);
  return {
    name: it.name,
    shutDown: left > 0 ? `Shut down: ${left} ${left === 1 ? 'turn' : 'turns'} left` : null,
    mine: [
      ...vehicleStats(world, me).weapons.map((mw, i) => row(world, me, mw, it, aimAt(me, mw, it), `[${i + 1}] ${mw.def.name}`)),
      ...truckUtilities(me).map((part) => utilityRow(world, me, part, it, slotName(world, part))),
    ],
    theirs: [
      ...vehicleStats(world, it).weapons.map((mw) => row(world, it, mw, me, aimAt(it, mw, me), mw.def.name)),
      ...truckUtilities(it).map((part) => utilityRow(world, it, part, me, partDef(part.defId).name)),
    ],
  };
}

export class HitCard {
  private root = el('div', { class: 'hitcard' });

  constructor(container: HTMLElement) {
    this.root.style.display = 'none';
    container.append(this.root);
  }

  // Combat details share the fixed vehicle inspection panel.
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
    const shutDown = card.shutDown ? [el('div', { class: 'hc-cause' }, card.shutDown)] : [];
    this.root.replaceChildren(...shutDown, ...section('You → it', card.mine), ...section('It → you', card.theirs));
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  show(): void {
    if (this.root.childElementCount === 0) return this.hide();
    this.root.style.display = '';
  }
}
