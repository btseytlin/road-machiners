import { describe, expect, it } from 'vitest';
import { FORTRESS } from '../../data/fortress';
import { REGION } from '../../data/region';
import { fortressFootprint, fortressOutline, fortressPieces } from '../../sim/fortress';
import { isFortress, type Site } from '../../sim/sites';
import { pointInPolygon, type Vec } from '../../sim/vec';
import { POOLS, bakePools, poolSide, poolTextureSize, samplePools, type PoolLamp } from './lightPools';

const SITES: Site[] = [...REGION.towns, ...REGION.locations].filter(isFortress);
const SIZE = poolTextureSize(REGION.size, REGION.size * POOLS.texelsPerTile);
const HANG = 0.7;

type Face = { site: Site; face: Vec; n: Vec; inside: boolean };

function wallFaces(site: Site): Face[] {
  const outline = fortressOutline(site);
  return fortressPieces(site)
    .filter((piece) => piece.kind === 'wall')
    .flatMap((piece) =>
      [1, -1].map((s) => {
        const n = { x: -Math.sin(piece.yaw) * s, y: Math.cos(piece.yaw) * s };
        const face = { x: piece.pos.x + (n.x * FORTRESS.wallDepth) / 2, y: piece.pos.y + (n.y * FORTRESS.wallDepth) / 2 };
        return { site, face, n, inside: pointInPolygon({ x: face.x + n.x, y: face.y + n.y }, outline) };
      }),
    );
}

const pushed = (f: Face): Vec => ({ x: f.face.x + f.n.x * POOLS.push, y: f.face.y + f.n.y * POOLS.push });
const solidsOf = (site: Site) => fortressPieces(site).map((piece) => fortressFootprint(site, piece));
const open = (f: Face) => poolSide(f.site, solidsOf(f.site), pushed(f)) !== 'solid';
const FACES = SITES.flatMap(wallFaces).filter(open);
const lampAt = (f: Face): PoolLamp => ({ site: f.site, x: f.face.x + f.n.x * HANG, z: f.face.y + f.n.y * HANG, inside: f.inside });
const seen = (data: Uint8Array, f: Face) => samplePools(data, SIZE, pushed(f));

describe('night light pools (IV1, IV4)', () => {
  it('finds wall faces on both sides of every fortress curtain', () => {
    for (const site of SITES) {
      expect(FACES.some((f) => f.site === site && f.inside), site.id).toBe(true);
      expect(FACES.some((f) => f.site === site && !f.inside), site.id).toBe(true);
    }
  });

  it('keeps outer lamp light off every inner wall face, and lights the outer faces (IV1)', () => {
    const data = bakePools(FACES.filter((f) => !f.inside).map(lampAt), SIZE);
    for (const f of FACES.filter((f) => f.inside)) expect(seen(data, f), `${f.site.id} ${f.face.x.toFixed(1)},${f.face.y.toFixed(1)}`).toBe(0);
    for (const f of FACES.filter((f) => !f.inside)) expect(seen(data, f), f.site.id).toBeGreaterThan(0.2);
  });

  it('keeps inner lamp light off every outer wall face, and lights the inner faces (IV1)', () => {
    const data = bakePools(FACES.filter((f) => f.inside).map(lampAt), SIZE);
    for (const f of FACES.filter((f) => !f.inside)) expect(seen(data, f), `${f.site.id} ${f.face.x.toFixed(1)},${f.face.y.toFixed(1)}`).toBe(0);
    for (const f of FACES.filter((f) => f.inside)) expect(seen(data, f), f.site.id).toBeGreaterThan(0.2);
  });

  it('refuses a pool texture larger than the renderer allows (IV4)', () => {
    expect(() => poolTextureSize(REGION.size, REGION.size * POOLS.texelsPerTile - 1)).toThrow(/renderer allows/);
  });
});
