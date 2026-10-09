import * as THREE from 'three';
import { count } from '../../../perf';
import { PROP_BIT, TRUCK_BIT } from '../models';

export const CARD_SHAPES = 4;
const ATLAS_PX = 256;
const ATLAS_CELLS = 2;
const SHAPE_LUMPS = { min: 4, spread: 3 };
const SHAPE_BLUR_PX = 6;
const CARD_LIGHT = { scatter: 0.7 };
const CARD_ORDER = { lit: 904, glow: 906 };
const FILL_ALPHA_STEPS = 64;
const ROUND_EDGE = '(1.0 - smoothstep(0.84, 1.0, length(vBall)))';
export const OVERFILL_COUNTER = 'fx.cards.overfilled';

export type CardLight = { sunDir: THREE.Vector3; sun: THREE.Color; sky: THREE.Color; ground: THREE.Color };

export type FxCards = { lit: CardBatch; glow: CardBatch };

export type Card = {
  x: number;
  y: number;
  z: number;
  size: number;
  spin: number;
  shape: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  sx: number;
  sy: number;
  sz: number;
};

const VERTEX = `
  attribute vec3 offset;
  attribute vec3 stretch;
  attribute vec2 sizeSpin;
  attribute float shape;
  attribute vec4 tint;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec2 vBall;
  varying vec4 vTint;
  varying vec3 vSun;
  varying vec3 vUp;
  void main() {
    float c = cos(sizeSpin.y);
    float s = sin(sizeSpin.y);
    vec2 turned = mat2(c, s, -s, c) * (uv - 0.5) + 0.5;
    float col = mod(shape, ${ATLAS_CELLS}.0);
    float row = floor(shape / ${ATLAS_CELLS}.0);
    vUv = (turned + vec2(col, row)) / ${ATLAS_CELLS}.0;
    vBall = (uv - 0.5) * 2.0;
    vTint = tint;
    vSun = normalize((viewMatrix * vec4(sunDir, 0.0)).xyz);
    vUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec4 mv = modelViewMatrix * vec4(offset, 1.0);
    vec2 along = (modelViewMatrix * vec4(stretch, 0.0)).xy;
    float reach = length(along);
    vec2 ax = reach > 0.0001 ? along / reach : vec2(1.0, 0.0);
    vec2 corner = position.xy * sizeSpin.x;
    mv.xy += reach > 0.0001 ? ax * position.x * (sizeSpin.x + reach) + vec2(-ax.y, ax.x) * corner.y - along * 0.5 : corner;
    #ifdef OVER_SOLIDS
    mv.z -= sizeSpin.x * 0.5;
    #endif
    gl_Position = projectionMatrix * mv;
  }
`;

const LIT_FRAGMENT = `
  uniform sampler2D shapes;
  uniform vec3 sunColor;
  uniform vec3 skyColor;
  uniform vec3 groundColor;
  varying vec2 vUv;
  varying vec2 vBall;
  varying vec4 vTint;
  varying vec3 vSun;
  varying vec3 vUp;
  void main() {
    float a = vTint.a * texture2D(shapes, vUv).a * ${ROUND_EDGE};
    if (a <= 0.003) discard;
    vec3 n = normalize(vec3(vBall, sqrt(max(0.0, 1.0 - dot(vBall, vBall) * 0.5))));
    vec3 sky = mix(groundColor, skyColor, 0.5 * dot(n, vUp) + 0.5);
    float wrap = 0.5 * dot(n, vSun) + 0.5;
    vec3 light = (mix(${CARD_LIGHT.scatter.toFixed(3)}, 1.0, wrap * wrap) * sunColor + sky) * ${(1 / Math.PI).toFixed(6)};
    gl_FragColor = vec4(vTint.rgb * light, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const GLOW_FRAGMENT = `
  uniform sampler2D shapes;
  varying vec2 vUv;
  varying vec2 vBall;
  varying vec4 vTint;
  void main() {
    float a = vTint.a * texture2D(shapes, vUv).a * ${ROUND_EDGE};
    if (a <= 0.003) discard;
    gl_FragColor = vec4(vTint.rgb, a);
    #include <colorspace_fragment>
  }
`;

export class CardBatch {
  readonly meshes: readonly THREE.Mesh[];
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly uniforms = {
    shapes: { value: null as THREE.Texture | null },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color() },
    skyColor: { value: new THREE.Color() },
    groundColor: { value: new THREE.Color() },
  };
  private readonly offsets: THREE.InstancedBufferAttribute;
  private readonly stretches: THREE.InstancedBufferAttribute;
  private readonly sizeSpins: THREE.InstancedBufferAttribute;
  private readonly shapes: THREE.InstancedBufferAttribute;
  private readonly tints: THREE.InstancedBufferAttribute;
  private readonly cards: Card[] = [];
  private readonly depth = new THREE.Vector3();

  constructor(private readonly capacity: number, private readonly kind: 'lit' | 'glow', shapes: THREE.Texture, private readonly fillScreens: number) {
    if (!(fillScreens > 0)) throw new Error(`CardBatch needs a positive fill ceiling, got ${fillScreens}`);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.offsets = this.attribute('offset', 3);
    this.stretches = this.attribute('stretch', 3);
    this.sizeSpins = this.attribute('sizeSpin', 2);
    this.shapes = this.attribute('shape', 1);
    this.tints = this.attribute('tint', 4);
    this.geo.instanceCount = 0;
    this.meshes = [false, true].map((overSolids) => {
      const mesh = new THREE.Mesh(this.geo, cardMaterial(kind, this.uniforms, overSolids));
      mesh.frustumCulled = false;
      mesh.renderOrder = kind === 'lit' ? CARD_ORDER.lit : CARD_ORDER.glow;
      return mesh;
    });
    this.uniforms.shapes.value = shapes;
  }

  light(l: CardLight): void {
    const u = this.uniforms;
    u.sunDir.value.copy(l.sunDir);
    u.sunColor.value.copy(l.sun);
    u.skyColor.value.copy(l.sky);
    u.groundColor.value.copy(l.ground);
  }

  push(card: Card): void {
    if (this.cards.length >= this.capacity) throw new Error(`CardBatch over its ${this.capacity} cards; the client pools must cap below it`);
    this.cards.push(card);
  }

  flush(camera: THREE.Camera): void {
    this.fitFill(camera);
    if (this.kind === 'lit') this.sortBackToFront(camera);
    this.cards.forEach((c, i) => {
      this.offsets.setXYZ(i, c.x, c.y, c.z);
      this.stretches.setXYZ(i, c.sx, c.sy, c.sz);
      this.sizeSpins.setXY(i, c.size, c.spin);
      this.shapes.setX(i, c.shape);
      this.tints.setXYZW(i, c.r, c.g, c.b, c.alpha);
    });
    this.geo.instanceCount = this.cards.length;
    for (const a of [this.offsets, this.stretches, this.sizeSpins, this.shapes, this.tints]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.cards.length * a.itemSize);
      a.needsUpdate = true;
    }
    this.cards.length = 0;
  }

  private fitFill(camera: THREE.Camera): void {
    const e = camera.projectionMatrix.elements;
    if (e[15] !== 1) throw new Error('The card fill ceiling needs an orthographic camera');
    const screensOf = (c: Card) => c.size * e[0] * 0.5 * (c.size + Math.hypot(c.sx, c.sy, c.sz)) * e[5] * 0.5;
    let total = 0;
    for (const c of this.cards) total += screensOf(c);
    if (total <= this.fillScreens) return;
    const step = (c: Card) => Math.round(c.alpha * FILL_ALPHA_STEPS);
    this.cards.sort((a, b) => step(b) - step(a));
    let used = 0;
    let kept = 0;
    while (kept < this.cards.length && used + screensOf(this.cards[kept]) <= this.fillScreens) used += screensOf(this.cards[kept++]);
    count(OVERFILL_COUNTER, this.cards.length - kept);
    this.cards.length = kept;
  }

  private sortBackToFront(camera: THREE.Camera): void {
    const look = camera.getWorldDirection(this.depth);
    const d = (c: Card) => c.x * look.x + c.y * look.y + c.z * look.z;
    this.cards.sort((a, b) => d(b) - d(a));
  }

  private attribute(name: string, size: number): THREE.InstancedBufferAttribute {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute(name, a);
    return a;
  }
}

function cardMaterial(kind: 'lit' | 'glow', uniforms: Record<string, THREE.IUniform>, overSolids: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: kind === 'lit' ? LIT_FRAGMENT : GLOW_FRAGMENT,
    defines: overSolids ? { OVER_SOLIDS: '' } : {},
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: kind === 'lit' ? THREE.NormalBlending : THREE.AdditiveBlending,
    stencilWrite: true,
    stencilRef: 0,
    stencilFuncMask: TRUCK_BIT | PROP_BIT,
    stencilWriteMask: 0,
    stencilFunc: overSolids ? THREE.NotEqualStencilFunc : THREE.EqualStencilFunc,
  });
}

export function createCardShapes(random: () => number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the card shape atlas');
  const cell = ATLAS_PX / ATLAS_CELLS;
  ctx.filter = `blur(${SHAPE_BLUR_PX}px)`;
  ctx.fillStyle = '#fff';
  for (let i = 0; i < CARD_SHAPES; i++) {
    const cx = (i % ATLAS_CELLS) * cell + cell / 2;
    const cy = Math.floor(i / ATLAS_CELLS) * cell + cell / 2;
    for (const lump of lumpsOf(random)) {
      ctx.beginPath();
      ctx.arc(cx + lump.x * cell, cy + lump.y * cell, lump.r * cell, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  return texture;
}

function lumpsOf(random: () => number): { x: number; y: number; r: number }[] {
  const n = SHAPE_LUMPS.min + Math.floor(random() * SHAPE_LUMPS.spread);
  const lumps = [{ x: 0, y: 0, r: 0.24 }];
  for (let i = 1; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + random();
    const reach = 0.1 + random() * 0.08;
    lumps.push({ x: Math.cos(a) * reach, y: Math.sin(a) * reach, r: 0.12 + random() * 0.08 });
  }
  return lumps;
}
