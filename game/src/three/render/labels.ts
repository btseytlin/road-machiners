// HTML labels floating over the map: site labels for towns and locations, and vehicle markers. Site labels
// follow the old 2D WorldScene rules: sites under never-explored fog or past gray vision show nothing, explored but
// undiscovered sites show ???, discovered sites show their name. A wreck a driver told of shows a rumor label,
// also under fog, until its stock is gone.

import { REGION } from '../../data/region';
import { groundPoint, type VehicleFrame } from '../../phys/frames';
import { PAL } from '../../render/palette';
import type { World } from '../../sim/types';
import type { Vec } from '../../sim/vec';
import { el } from '../../ui/dom';
import { createIcon } from '../../ui/cards';
import type { JobMark, VehicleMark, WeaponMark } from '../../ui/weapons';
import { playerExplored } from '../../sim/vision';
import type { CameraRig } from './camera';
import type { SightLimit } from './scope';

const LABEL_LIFT_PX = 90; // pixels above the ground point, matches the old 2D label offset
const RUMOR_TEXT = 'Wreck (rumor)';

type Site = { id: string; name: string; pos: { x: number; y: number } };

function labelEl(container: HTMLElement): HTMLDivElement {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.transform = 'translate(-50%, -100%)';
  el.style.font = '15px var(--font-mono)';
  el.style.color = PAL.text;
  el.style.background = '#1a1410aa'; // PAL.bg with alpha, matches the old 2D label backing
  el.style.padding = '3px 6px';
  el.style.whiteSpace = 'nowrap';
  el.style.pointerEvents = 'none';
  container.appendChild(el);
  return el;
}

// Shows the label at a map point, or hides it past gray vision.
function place(el: HTMLDivElement, world: World, pos: Vec, rig: CameraRig, limit: SightLimit, explored: boolean): void {
  const ground = groundPoint(world.terrain, pos);
  const seen = explored && limit.covers(ground);
  el.style.display = seen ? 'block' : 'none';
  if (!seen) return;
  const screen = rig.screenOf(ground);
  el.style.left = `${screen.x}px`;
  el.style.top = `${screen.y - LABEL_LIFT_PX}px`;
}

export class Labels {
  private els = new Map<string, HTMLDivElement>();
  private rumors = new Map<string, HTMLDivElement>(); // by salvage stock id

  constructor(private readonly container: HTMLElement) {
    for (const s of sites()) this.els.set(s.id, labelEl(container));
  }

  update(world: World, rig: CameraRig, limit: SightLimit): void {
    for (const s of sites()) {
      const el = this.els.get(s.id)!;
      el.textContent = world.player.discovered.includes(s.id) ? s.name : '???';
      place(el, world, s.pos, rig, limit, playerExplored(world, s.pos));
    }
    this.updateRumors(world, rig, limit);
  }

  private updateRumors(world: World, rig: CameraRig, limit: SightLimit): void {
    const stocks = world.salvage.filter((s) => world.player.rumored.includes(s.id));
    const ids = new Set(stocks.map((s) => s.id));
    for (const [id, el] of this.rumors) {
      if (ids.has(id)) continue;
      el.remove();
      this.rumors.delete(id);
    }
    for (const stock of stocks) {
      let el = this.rumors.get(stock.id);
      if (!el) {
        el = labelEl(this.container);
        el.textContent = RUMOR_TEXT;
        this.rumors.set(stock.id, el);
      }
      place(el, world, stock.pos, rig, limit, true);
    }
  }
}

function sites(): Site[] {
  return [...REGION.towns, ...REGION.locations];
}

function weaponChip(mark: WeaponMark): HTMLElement {
  return el('div', { class: `marker-weapon ${mark.ready ? 'ready' : 'blocked'}`, title: mark.status },
    createIcon(mark.look),
    el('span', { class: 'marker-slot' }, String(mark.slot)),
    el('span', { class: 'marker-status' }, mark.status),
  );
}

function jobChip(job: JobMark): HTMLElement {
  return el('div', { class: 'marker-job' },
    el('span', {}, job.label),
    el('span', { class: 'job-bar' }, el('span', { style: `width:${Math.round(job.progress * 100)}%` })),
  );
}

function weaponsRow(weapons: WeaponMark[]): HTMLElement | null {
  return weapons.length > 0 ? el('div', { class: 'marker-weapons' }, ...weapons.map(weaponChip)) : null;
}

function stopChip(): HTMLElement {
  return el('div', { class: 'marker-stop' }, el('span', { class: 'stop-sign' }, 'STOP'), el('span', {}, 'Click: stop'));
}

function markerNode(mark: VehicleMark): HTMLElement {
  return el('div', { class: 'vehicle-marker' },
    weaponsRow(mark.weapons),
    mark.radio ? el('div', { class: 'marker-radio' }, '[T] Radio') : null,
    mark.out ? el('div', { class: 'marker-out' }, mark.gaveUp ? 'Gave up' : 'Knocked out') : null,
    mark.job ? jobChip(mark.job) : null,
    mark.stop ? stopChip() : null,
  );
}

const MARKER_LIFT = 3.5; // meters above a vehicle where its label sits

// Markers above vehicles: an icon per player weapon aimed at the vehicle, the radio key on the hovered
// truck, the stop sign over the player truck, a knocked-out driver, and the job an NPC works on. The content comes from vehicleMarks() in src/ui/weapons.ts.
export class VehicleMarkers {
  private readonly els = new Map<string, HTMLElement>(); // by vehicle id

  constructor(private readonly container: HTMLElement, private readonly rig: CameraRig) {}

  refresh(marks: Map<string, VehicleMark>): void {
    for (const node of this.els.values()) node.remove();
    this.els.clear();
    for (const [id, mark] of marks) {
      const node = markerNode(mark);
      this.container.appendChild(node);
      this.els.set(id, node);
    }
  }

  // Weapons and the radio key hide while turns advance. Jobs stay, so their bars step each turn.
  place(frames: Record<string, VehicleFrame>, hideAims: boolean, hideAll: boolean): void {
    for (const [id, node] of this.els) {
      const f = frames[id];
      node.style.display = hideAll || !f ? 'none' : 'flex';
      if (hideAll || !f) continue;
      node.classList.toggle('aims-hidden', hideAims);
      const p = this.rig.screenOf({ x: f.pos.x, y: f.pos.y + MARKER_LIFT, z: f.pos.z });
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
    }
  }
}
