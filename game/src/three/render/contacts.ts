// Markers for vehicles detected beyond sight: sound and radio. Dust is drawn as clouds by dust.ts. All are drawn above the fog: a contact
// is sensed, not seen, so it does not depend on the fog of war.
// - Sound: faint white wavefronts, in bursts. Each turn opens with a burst of quick ripples, then a long

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { WEATHER } from '../../data/weather';
import { PAL } from '../../render/palette';
import { hash2, valueNoise } from '../../render/noise';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Contact } from '../../sim/types';
import { dist, type Vec } from '../../sim/vec';

const S = PHYSICS.metersPerTile;
const RENDER_ORDER = 905;
const LIFT = 0.08;

const SHOW_SOUND_WAVES = false;

const WAVE = {
  points: 64,
  fronts: 3,
  speed: 24,
  reachPast: 1.3,
  brightness: 0.7,
  climbDrag: 3,
  shadowFade: 2.5,
  wind: 0.35,
  wobble: 0.06,
  wobbleScale: 3,
  originSpread: 0.7,
  stagger: 0.25,
  repeat: 14,
};

const BLIP = { radius: 0.7, dot: 0.25, opacity: 0.9 };

type Front = {
  line: THREE.Line;
  origin: Vec;
  r: Float32Array;
  peak: Float32Array;
  amp: Float32Array;
  active: boolean;
  ran: boolean;
  spawn: number;
};

type Marker = { id: string; fronts: Front[]; blip: THREE.Group; root: THREE.Group; burstMs: number };

const WIND = (() => {
  const l = Math.hypot(WEATHER.wind.x, WEATHER.wind.y);
  return { x: WEATHER.wind.x / l, y: WEATHER.wind.y / l };
})();

export class ContactsView {
  readonly root = new THREE.Group();
  private readonly markers = new Map<string, Marker>();
  private lastMs: number | null = null;
  private lastTurn = -1;

  update(terrain: Terrain, contacts: Contact[], listener: Vec, turn: number, nowMs: number): void {
    const dt = this.lastMs === null ? 0 : Math.min(0.1, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    const newTurn = turn !== this.lastTurn;
    this.lastTurn = turn;
    if (newTurn) for (const m of this.markers.values()) startBurst(m, nowMs);
    const live = new Set(contacts.map((c) => c.vehicleId));
    for (const [id, m] of this.markers) {
      if (live.has(id)) continue;
      this.root.remove(m.root);
      disposeMarker(m);
      this.markers.delete(id);
    }
    for (const c of contacts) {
      let m = this.markers.get(c.vehicleId);
      if (!m) {
        m = this.makeMarker(c.vehicleId);
        this.markers.set(c.vehicleId, m);
        startBurst(m, nowMs);
      }
      if (nowMs - m.burstMs >= WAVE.repeat * 1000) startBurst(m, nowMs);
      const hearsSound = SHOW_SOUND_WAVES && c.sources.includes('sound');
      m.fronts.forEach((f) => (f.line.visible = hearsSound));
      if (hearsSound) m.fronts.forEach((f, k) => this.advanceFront(terrain, c, listener, f, dt, (nowMs - m.burstMs) / 1000 >= k * WAVE.stagger));
      placeBlip(terrain, m.blip, c);
    }
  }

  private makeMarker(id: string): Marker {
    const root = new THREE.Group();
    const seed = hashId(id);
    const fronts = Array.from({ length: WAVE.fronts }, (_, k) => makeFront(k, seed));
    const blip = makeBlip();
    root.add(...fronts.map((f) => f.line), blip);
    this.root.add(root);
    return { id, fronts, blip, root, burstMs: 0 };
  }

  private advanceFront(terrain: Terrain, c: Contact, listener: Vec, f: Front, dt: number, due: boolean): void {
    if (!f.active && (f.ran || !due)) {
      f.line.visible = false;
      return;
    }
    if (!f.active) {
      this.restartFront(terrain, c, f);
      f.active = true;
      f.ran = true;
    }
    const reach = Math.max(c.radius * 2, dist(c.center, listener) * WAVE.reachPast);
    const n = WAVE.points;
    const pos = f.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = f.line.geometry.getAttribute('color') as THREE.BufferAttribute;
    const base = heightAt(terrain, f.origin.x, f.origin.y);
    let mean = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const dir = { x: Math.cos(a), y: Math.sin(a) };
      const here = { x: f.origin.x + dir.x * f.r[i], y: f.origin.y + dir.y * f.r[i] };
      const h = heightAt(terrain, here.x, here.y);
      const step = 0.5;
      const grade = (heightAt(terrain, here.x + dir.x * step, here.y + dir.y * step) - h) / step;
      const wind = 1 + WAVE.wind * (dir.x * WIND.x + dir.y * WIND.y);
      const speed = (WAVE.speed * wind) / (1 + WAVE.climbDrag * Math.max(0, grade));
      f.r[i] += speed * dt;
      f.peak[i] = Math.max(f.peak[i], h, base);
      f.amp[i] = Math.exp(-WAVE.shadowFade * (f.peak[i] - h));
      mean += f.r[i];
    }
    mean /= n;
    const fade = WAVE.brightness * Math.max(0, 1 - (mean / reach) ** 3);
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const a = (k / n) * Math.PI * 2;
      const wob = 1 + WAVE.wobble * (valueNoise(Math.cos(a) * WAVE.wobbleScale + f.spawn * 7.3, Math.sin(a) * WAVE.wobbleScale + mean * 0.2) * 2 - 1);
      const x = f.origin.x + Math.cos(a) * f.r[k] * wob;
      const y = f.origin.y + Math.sin(a) * f.r[k] * wob;
      pos.setXYZ(i, x * S, heightAt(terrain, x, y) * S + LIFT, y * S);
      const v = fade * f.amp[k];
      col.setXYZ(i, v, v, v);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    f.line.visible = true;
    if (mean >= reach) f.active = false;
  }

  private restartFront(terrain: Terrain, c: Contact, f: Front): void {
    f.spawn++;
    const seed = hashId(f.line.name) + f.spawn;
    const a = hash2(seed, 11) * Math.PI * 2;
    const r = Math.sqrt(hash2(seed, 23)) * c.radius * WAVE.originSpread;
    f.origin = { x: c.center.x + Math.cos(a) * r, y: c.center.y + Math.sin(a) * r };
    const base = heightAt(terrain, f.origin.x, f.origin.y);
    f.r.fill(0);
    f.peak.fill(base);
    f.amp.fill(1);
  }
}

function startBurst(m: Marker, nowMs: number): void {
  m.burstMs = nowMs;
  for (const f of m.fronts) {
    f.active = false;
    f.ran = false;
  }
}

function makeFront(k: number, seed: number): Front {
  const n = WAVE.points;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
  const mat = new THREE.LineBasicMaterial({ color: PAL.contact, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  line.name = `front-${seed}-${k}`;
  line.renderOrder = RENDER_ORDER;
  line.frustumCulled = false;
  line.visible = false;
  return { line, origin: { x: 0, y: 0 }, r: new Float32Array(n), peak: new Float32Array(n), amp: new Float32Array(n).fill(1), active: false, ran: false, spawn: seed % 1000 };
}

function makeBlip(): THREE.Group {
  const mat = () => new THREE.MeshBasicMaterial({ color: PAL.radio, transparent: true, opacity: BLIP.opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(BLIP.radius * S * 0.8, BLIP.radius * S, 32).rotateX(-Math.PI / 2), mat());
  const dot = new THREE.Mesh(new THREE.CircleGeometry(BLIP.dot * S, 16).rotateX(-Math.PI / 2), mat());
  ring.renderOrder = dot.renderOrder = RENDER_ORDER;
  const group = new THREE.Group();
  group.add(ring, dot);
  return group;
}

function placeBlip(terrain: Terrain, blip: THREE.Group, c: Contact): void {
  const color = blipColor(c);
  blip.visible = color !== null;
  if (color === null) return;
  blip.traverse((o) => {
    if (o instanceof THREE.Mesh) (o.material as THREE.MeshBasicMaterial).color.setHex(color);
  });
  blip.position.set(c.center.x * S, heightAt(terrain, c.center.x, c.center.y) * S + LIFT, c.center.y * S);
}

function blipColor(c: Contact): number | null {
  if (c.sources.includes('radio')) return PAL.radio;
  return c.sources.includes('flare') ? PAL.flare.marker : null;
}

function disposeMarker(m: Marker): void {
  for (const f of m.fronts) {
    f.line.geometry.dispose();
    (f.line.material as THREE.Material).dispose();
  }
  m.root.traverse((o) => {
    if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
