// Traveling dust. Small clouds are decoration, driven by wind alone. Storm banks sit on the sim's
// own storms in world.weather, so what the player sees matches the sight, speed and wear penalty.
// A bank's haze follows its storm's stormStrength, eased per frame, and fades out after the storm ends.
import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { WEATHER } from '../../data/weather';
import { hash2 } from '../../render/noise';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { World } from '../../sim/types';
import { stormStrength } from '../../sim/weather';

const S = PHYSICS.metersPerTile;
const WRAP_MARGIN = WEATHER.cloud.spread + WEATHER.cloud.diameter;

// Every puff of a bank shares one material, so a fade is one opacity write.
type Bank = { group: THREE.Group; material: THREE.SpriteMaterial; x: number; y: number; speed: number; height: number };
// shown is the haze share on screen now, target the sim strength it eases toward, 0 once the storm has ended.
type StormBank = Bank & { shown: number; target: number };
type Look = { puffs: number; spread: number; diameter: number; height: number; opacity: number; color: number };

function createDustTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create dust texture');
  const gradient = ctx.createRadialGradient(32, 32, 5, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// A stable hash from a storm's id, so its puff layout does not reshuffle every sync.
function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

export class WeatherView {
  readonly root = new THREE.Group();
  private readonly clouds: Bank[] = [];
  private readonly storms = new Map<string, StormBank>();
  private readonly terrain: Terrain;
  private readonly texture: THREE.CanvasTexture;

  constructor(world: World) {
    this.root.name = 'weather';
    this.terrain = world.terrain;
    this.texture = createDustTexture();
    const count = Math.max(1, Math.round(world.size / WEATHER.cloudSpacing));
    for (let i = 0; i < count; i++) {
      const x = hash2(world.seed + i, 29) * world.size;
      const y = hash2(world.seed + i, 43) * world.size;
      this.clouds.push(this.createBank(WEATHER.cloud, x, y, i, false));
    }
    this.sync(world);
    // A loaded storm shows at its true strength at once, with no full-strength flash and no fade from nothing.
    for (const bank of this.storms.values()) this.show(bank, bank.target);
  }

  // Adds a bank for each new sim storm, aims each bank at its storm's strength, or at 0 for one that ended,
  // and moves the live ones to their storm's current position. Cheap: world.weather holds only a few events.
  sync(world: World): void {
    for (const bank of this.storms.values()) bank.target = 0;
    for (const e of world.weather) {
      if (e.kind !== 'storm') continue;
      let bank = this.storms.get(e.id);
      if (!bank) {
        const puffs = Math.ceil((Math.PI * e.radius * e.radius) / WEATHER.storm.tilesPerPuff);
        bank = { ...this.createBank({ ...WEATHER.storm, puffs, spread: e.radius }, e.pos.x, e.pos.y, idHash(e.id), true), shown: 0, target: 0 };
        this.show(bank, 0);
        this.storms.set(e.id, bank);
      }
      bank.target = stormStrength(world, e);
      bank.x = e.pos.x;
      bank.y = e.pos.y;
      this.placeBank(bank);
    }
  }

  // Eases each storm bank's haze toward its target, and drops a bank whose storm ended once its haze is gone.
  fade(dtMs: number): void {
    const step = (WEATHER.storm.fadePerSecond * dtMs) / 1000;
    for (const [id, bank] of this.storms) {
      this.show(bank, stepFade(bank.shown, bank.target, step));
      if (bank.shown > 0 || bank.target > 0) continue;
      this.root.remove(bank.group);
      bank.material.dispose();
      this.storms.delete(id);
    }
  }

  // The haze share a storm's bank shows now, or null with no bank for it. For checks.
  shownOf(id: string): number | null {
    return this.storms.get(id)?.shown ?? null;
  }

  private show(bank: StormBank, shown: number): void {
    if (!(shown >= 0 && shown <= 1)) throw new Error(`Storm haze share ${shown} is outside 0 to 1`);
    bank.shown = shown;
    bank.material.opacity = WEATHER.storm.opacity * shown;
    bank.group.visible = shown > 0;
  }

  private createBank(shape: Look, x: number, y: number, index: number, storm: boolean): Bank {
    const group = new THREE.Group();
    group.name = storm ? 'dust-storm' : 'dust-cloud';
    const material = new THREE.SpriteMaterial({ map: this.texture, color: shape.color, transparent: true, opacity: shape.opacity, depthWrite: false });
    for (let i = 0; i < shape.puffs; i++) {
      const angle = hash2(index * 97 + i, storm ? 31 : 17) * Math.PI * 2;
      const radius = Math.sqrt(hash2(index * 47 + i, storm ? 59 : 41)) * shape.spread * S;
      const sprite = new THREE.Sprite(material);
      sprite.position.set(Math.cos(angle) * radius, hash2(index * 31 + i, 73) * S, Math.sin(angle) * radius);
      sprite.scale.setScalar(shape.diameter * S * (0.7 + hash2(i, index + 83) * 0.6));
      group.add(sprite);
    }
    this.root.add(group);
    const bank = { group, material, x, y, speed: storm ? 0 : 1, height: shape.height };
    this.placeBank(bank);
    return bank;
  }

  private placeBank(bank: Bank): void {
    bank.group.position.set(bank.x * S, (heightAt(this.terrain, bank.x, bank.y) + bank.height) * S, bank.y * S);
  }

  // Only the decorative clouds drift on their own; storms are repositioned by sync from sim state.
  advance(dtMs: number): void {
    const span = this.terrain.size + WRAP_MARGIN * 2;
    for (const bank of this.clouds) {
      bank.x = ((bank.x + WEATHER.wind.x * bank.speed * dtMs / 1000 + WRAP_MARGIN) % span + span) % span - WRAP_MARGIN;
      bank.y = ((bank.y + WEATHER.wind.y * bank.speed * dtMs / 1000 + WRAP_MARGIN) % span + span) % span - WRAP_MARGIN;
      this.placeBank(bank);
    }
  }
}

// Moves shown toward target by at most maxStep.
export function stepFade(shown: number, target: number, maxStep: number): number {
  return shown < target ? Math.min(target, shown + maxStep) : Math.max(target, shown - maxStep);
}
