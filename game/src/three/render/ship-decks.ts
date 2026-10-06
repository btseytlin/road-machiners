// The Fallen Sun's wing and flaps: a plate of each deck's look on each of its straight pieces, posed on the deck line
// like Broken Wing's deck, and a skirt strip under its rails and lips down into the ground, mirroring the physics skirt
// (addDeck() in src/phys/drive.ts). src/sim/bridge.ts owns the decks; this view only draws them. The strips stand a
// little inside the deck edge, behind the models' own torn skirt plates and lip beams, so the two never share a face.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { FALLEN_SUN_DECKS } from '../../data/territory';
import { hash2 } from '../../render/noise';
import { PAL } from '../../render/palette';
import { alongOf, deckById, railOffset, type Deck } from '../../sim/bridge';
import { deckHeight, deckSegments, groundAt, type Terrain } from '../../sim/terrain';
import { dist, type Vec } from '../../sim/vec';
import { poseOnDeck } from './sites';
import { model } from './models';
import type { RenderScope } from './scope';

const S = PHYSICS.metersPerTile;
// The models' reference sizes in meters (tools/blender/ship_wing_deck.py and ship_flap.py): length along the deck,
// width across it between the rail lines, and the flap's rise at its lip.
const WING = { length: 88, width: 32 };
const FLAP = { length: 20, width: 12, rise: 1.4 };
const RAIL_INSET = 0.5; // meters a rail's strip stands inside the rail line, behind the wing's hanging skirt plates
const LIP_INSET = 0.6; // meters a lip's strip stands inside the deck end, behind the flap's lip beam
const TOP_DROP = 0.1; // meters the strip's top lies under the deck line, inside the model's plate
const SKIRT_COLORS = [PAL.hull.grey, PAL.hull.dark, PAL.hull.dark, PAL.hull.rust];

type ShipDeck = { deck: Deck; look: (typeof FALLEN_SUN_DECKS)[number]['look'] };

// Every Fallen Sun deck's models and skirt, one group per deck, for inspection.
export function buildShipDecks(t: Terrain): THREE.Group {
  const root = new THREE.Group();
  for (const ship of shipDecks()) root.add(buildShipDeck(t, ship));
  return root;
}

// Registers each Fallen Sun deck's models and skirt with the scope at the deck's middle.
export function addShipDecks(t: Terrain, scope: RenderScope): void {
  for (const ship of shipDecks()) {
    const { deck } = ship;
    const mid = { x: deck.from.x + (deck.axis.x * deck.length) / 2, y: deck.from.y + (deck.axis.y * deck.length) / 2 };
    scope.add(buildShipDeck(t, ship), mid, Math.hypot(deck.length, deck.width) / 2);
  }
}

function shipDecks(): ShipDeck[] {
  return FALLEN_SUN_DECKS.map((spec) => ({ deck: deckById(spec.id), look: spec.look }));
}

function buildShipDeck(t: Terrain, ship: ShipDeck): THREE.Group {
  const { deck } = ship;
  const root = new THREE.Group();
  root.name = `ship-deck-${deck.id}`;
  for (const seg of deckSegments(t, deck)) {
    const plate = deckModel(ship, seg.length);
    plate.name = 'ship-deck-model';
    poseOnDeck(plate, deck, seg, 0);
    root.add(plate);
  }
  root.add(skirt(t, deck));
  root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return root;
}

// The deck's look stretched over one straight piece length tiles long: a wing plate, or a flap.
function deckModel({ deck, look }: ShipDeck, length: number): THREE.Object3D {
  if (look === 'ship_wing_deck') {
    const obj = model('ship_wing_deck');
    obj.scale.set((length * S) / WING.length, 1, (deck.width * S) / WING.width);
    return obj;
  }
  // The flap model has its hinge on the ground at -x and its lip at +x, which poseOnDeck puts at the to end.
  const rises = deck.stations.map((s) => s.rise);
  if (rises.length !== 2 || rises[0] !== 0 || rises[1] <= 0) throw new Error(`Flap ${deck.id} must rise from 0 at its from end to its lip, not [${rises.join(', ')}]`);
  const obj = model('ship_flap');
  obj.scale.set((length * S) / FLAP.length, (rises[1] * S) / FLAP.rise, (deck.width * S) / FLAP.width);
  return obj;
}

// A strip from just under the deck line down past the ground, sampled every tile, along each rail of a skirted deck
// and across each lip. It reaches PHYSICS.rockSink under the ground, as the physics skirt does.
function skirt(t: Terrain, deck: Deck): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const edges = [...(deck.skirt ? railPieces(deck) : []), ...deck.lips.map((line) => ({ line, inward: lipInward(deck, line), inset: LIP_INSET }))];
  edges.forEach(({ line: [a, b], inward, inset }, e) => {
    const steps = Math.max(1, Math.ceil(dist(a, b)));
    const cols = Array.from({ length: steps + 1 }, (_, k) => column(t, deck, { x: a.x + ((b.x - a.x) * k) / steps + (inward.x * inset) / S, y: a.y + ((b.y - a.y) * k) / steps + (inward.y * inset) / S }));
    for (let k = 0; k < steps; k++) {
      const [p, q] = [cols[k], cols[k + 1]];
      positions.push(...p.top, ...p.bottom, ...q.top, ...q.top, ...p.bottom, ...q.bottom);
      const color = new THREE.Color(SKIRT_COLORS[Math.floor(hash2(k + 31 * e, deck.length * 7) * SKIRT_COLORS.length)]);
      for (let v = 0; v < 6; v++) colors.push(color.r, color.g, color.b);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = 'ship-deck-skirt';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// A strip column at a map point, in meters: its top under the deck line and its bottom under the ground. Where the
// deck line dips under the ground the column is empty, its bottom at its top.
function column(t: Terrain, deck: Deck, p: Vec): { top: [number, number, number]; bottom: [number, number, number] } {
  const along = Math.min(deck.length, Math.max(0, alongOf(deck, p.x, p.y)));
  const top = deckHeight(t, deck, along) * S - TOP_DROP;
  const bottom = Math.min(top, groundAt(t, p.x, p.y) * S - PHYSICS.rockSink);
  return { top: [p.x * S, top, p.y * S], bottom: [p.x * S, bottom, p.y * S] };
}

// Each rail cut at the deck's stations, so its strip's top follows each change of grade, with the unit vector back
// across the deck.
function railPieces(deck: Deck): { line: [Vec, Vec]; inward: Vec; inset: number }[] {
  return [-1, 1].flatMap((side) => {
    const off = railOffset(deck.axis, deck.width, side);
    const inward = { x: (-off.x * 2) / deck.width, y: (-off.y * 2) / deck.width };
    return deck.stations.slice(1).map((b, k): { line: [Vec, Vec]; inward: Vec; inset: number } => {
      const a = deck.stations[k];
      return { line: [{ x: a.at.x + off.x, y: a.at.y + off.y }, { x: b.at.x + off.x, y: b.at.y + off.y }], inward, inset: RAIL_INSET };
    });
  });
}

// The unit vector from a lip back along the deck toward its middle.
function lipInward(deck: Deck, [a, b]: [Vec, Vec]): Vec {
  const atTo = alongOf(deck, (a.x + b.x) / 2, (a.y + b.y) / 2) > deck.length / 2;
  return atTo ? { x: -deck.axis.x, y: -deck.axis.y } : deck.axis;
}
