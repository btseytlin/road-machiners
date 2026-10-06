import { describe, expect, it } from 'vitest';
import { MAPGEN } from '../data/terrain';
import { newDraft, typeCode, type MapDraft } from '../mapgen/bake';
import { decodeMap, encodeMap, PROP_KINDS, TYPE_IDS, type BakedProp } from './terrain';

const PROP_BYTES = 1 + 4 * 4 + 2 * 2;

// A 3 x 3 tile draft with distinct heights, types and three props: a rock, a crag and a pole of a power line.
function smallDraft(): MapDraft {
  const d = newDraft(3);
  d.heights.forEach((_, k) => (d.heights[k] = k * 0.25 - 2));
  d.types.set([typeCode('road'), typeCode('sand'), typeCode('ash'), typeCode('scree'), typeCode('mud'), typeCode('hardpan'), typeCode('gravel'), typeCode('scrub'), typeCode('asphalt')]);
  d.props = [
    { kind: 'rock', pos: { x: 1.5, y: 2.25 }, r: 0.75, yaw: 0, group: 0, step: 0 },
    { kind: 'crag', pos: { x: 0.5, y: 0.5 }, r: 1.25, yaw: 2.5, group: 0, step: 0 },
    { kind: 'pole', pos: { x: 2.75, y: 1.5 }, r: 0.25, yaw: -1.5, group: 3, step: 65535 },
  ];
  return d;
}

describe('map file', () => {
  it('round-trips heights, types, props and the map seed', () => {
    const map = decodeMap(encodeMap(smallDraft(), 42));

    expect(map.seed).toBe(42);
    expect(map.terrain.size).toBe(3);
    expect(map.terrain.heights).toEqual(Array.from(smallDraft().heights));
    expect(map.terrain.types).toEqual(['road', 'sand', 'ash', 'scree', 'mud', 'hardpan', 'gravel', 'scrub', 'asphalt']);
    expect(map.props).toEqual(smallDraft().props);
  });

  it('round-trips every prop kind', () => {
    const d = smallDraft();
    d.props = PROP_KINDS.map((kind, k): BakedProp => ({ kind, pos: { x: k * 0.125, y: 1 }, r: 0.5, yaw: k * 0.25, group: k, step: k + 1 }));

    expect(decodeMap(encodeMap(d, 1)).props).toEqual(d.props);
  });

  it('stores prop kinds and ground types in this order, which only a new file version may change', () => {
    expect(PROP_KINDS).toEqual(['rock', 'crag', 'ruin', 'house', 'silo', 'waterTower', 'gasStation', 'bridgeSpan', 'pole', 'billboard', 'tank', 'shack', 'fence', 'junk', 'carWreck', 'hullChunk', 'shipCache', 'reactor', 'deadTree', 'farmhouse', 'barn', 'armyCache', 'bunker', 'armyTruck', 'sandbags', 'quonset', 'guardPost', 'barrier', 'drums', 'woodpile', 'shipWing', 'hullCache', 'shipBow', 'shipCage', 'shipHub', 'hullShell', 'hullDrum', 'hullShard', 'hullTower', 'hullGantry', 'rimRock']);
    expect(TYPE_IDS).toEqual(['road', 'hardpan', 'sand', 'scrub', 'scree', 'mud', 'gravel', 'saltCrust', 'asphalt', 'ash', 'field', 'dirtyWater', 'toxic', 'track', 'canal', 'concrete']);
  });

  it('round-trips pool ground types', () => {
    const d = smallDraft();
    d.types[0] = typeCode('dirtyWater');
    d.types[1] = typeCode('toxic');

    expect(decodeMap(encodeMap(d, 1)).terrain.types.slice(0, 2)).toEqual(['dirtyWater', 'toxic']);
  });

  it('refuses a prop the file cannot store', () => {
    const unknownKind = smallDraft();
    unknownKind.props[0] = { ...unknownKind.props[0], kind: 'castle' as BakedProp['kind'] };
    const bigStep = smallDraft();
    bigStep.props[2] = { ...bigStep.props[2], step: 65536 };
    const badGroup = smallDraft();
    badGroup.props[2] = { ...badGroup.props[2], group: -1 };

    expect(() => encodeMap(unknownKind, 1)).toThrow(/kind/i);
    expect(() => encodeMap(bigStep, 1)).toThrow(/step/i);
    expect(() => encodeMap(badGroup, 1)).toThrow(/group/i);
  });

  it('refuses a file with an unknown prop kind', () => {
    const d = smallDraft();
    const bytes = encodeMap(d, 1);
    bytes[bytes.length - PROP_BYTES] = PROP_KINDS.length;

    expect(() => decodeMap(bytes)).toThrow(/prop kind/i);
  });

  it('refuses a version 1 file, which stored only rocks', () => {
    const bytes = encodeMap(smallDraft(), 1);
    new DataView(bytes.buffer).setUint32(4, 1, true);

    expect(() => decodeMap(bytes)).toThrow(/version 1\b/i);
  });

  it('refuses a version 2 file, whose prop and ground codes still held the old Fallen Sun hull', () => {
    const bytes = encodeMap(smallDraft(), 1);
    new DataView(bytes.buffer).setUint32(4, 2, true);

    expect(() => decodeMap(bytes)).toThrow(/version 2\b/i);
  });

  it('rounds heights to the stored step', () => {
    const d = smallDraft();
    d.heights[0] = 1.23456;

    expect(decodeMap(encodeMap(d, 1)).terrain.heights[0]).toBe(Math.round(1.23456 * MAPGEN.heightScale) / MAPGEN.heightScale);
  });

  it('gives the same bytes and hash for the same draft', () => {
    const a = encodeMap(smallDraft(), 1);
    const b = encodeMap(smallDraft(), 1);

    expect(a).toEqual(b);
    expect(decodeMap(a).hash).toBe(decodeMap(b).hash);
  });

  it('changes the hash when one byte changes', () => {
    const bytes = encodeMap(smallDraft(), 1);
    const changed = bytes.slice();
    changed[changed.length - 1] ^= 1;

    expect(decodeMap(changed).hash).not.toBe(decodeMap(bytes).hash);
  });

  it('refuses a height the file cannot store', () => {
    const d = smallDraft();
    d.heights[4] = 40000 / MAPGEN.heightScale;

    expect(() => encodeMap(d, 1)).toThrow(/height/i);
  });

  it('refuses a file with a bad magic, version or length', () => {
    const bytes = encodeMap(smallDraft(), 1);
    const badMagic = bytes.slice();
    badMagic[0] = 0;
    const badVersion = bytes.slice();
    badVersion[4] += 1;

    expect(() => decodeMap(badMagic)).toThrow(/magic/i);
    expect(() => decodeMap(badVersion)).toThrow(/version/i);
    expect(() => decodeMap(bytes.slice(0, bytes.length - 1))).toThrow(/length/i);
    expect(() => decodeMap(new Uint8Array([...bytes, 0]))).toThrow(/length/i);
    expect(() => decodeMap(bytes.slice(0, 6))).toThrow(/length/i);
  });

  it('refuses a file with an unknown ground type', () => {
    const d = smallDraft();
    const bytes = encodeMap(d, 1);
    const heightsEnd = bytes.length - 4 - d.props.length * PROP_BYTES;
    bytes[heightsEnd - 1] = 250;

    expect(() => decodeMap(bytes)).toThrow(/ground type/i);
  });
});
