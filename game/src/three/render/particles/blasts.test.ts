import { describe, expect, it } from 'vitest';
import { BLAST_CAPS, BLAST_GLOW_MAX, Blasts } from './blasts';

function counted() {
  const n = { smoke: 0, glow: 0, chunks: 0 };
  const blasts = new Blasts({
    smoke: { spawn: () => void n.smoke++ },
    glow: { spawn: () => void n.glow++ },
    chunks: { spawn: () => void n.chunks++ },
  });
  return { n, blasts };
}

const AT = { x: 0, y: 0, z: 0 };
const GROUND = { color: 0xdcc08c, dust: 1 };

describe('Blasts budget', () => {
  it('keeps ten of the largest blasts under 1000 glow particles', () => {
    const { n, blasts } = counted();
    for (let i = 0; i < 10; i++) blasts.blast(AT, 1000, GROUND);
    expect(n.glow).toBeLessThan(1000);
    expect(n.glow).toBe(10 * BLAST_GLOW_MAX);
    expect(n.chunks).toBe(10 * BLAST_CAPS.chunks);
  });

  it('spawns more for a bigger radius up to the caps', () => {
    const small = counted();
    const big = counted();
    small.blasts.blast(AT, 0.8, GROUND);
    big.blasts.blast(AT, 10, GROUND);
    expect(big.n.glow).toBeGreaterThan(small.n.glow);
  });

  it('throws no chunks from an air burst or a truck hit', () => {
    const { n, blasts } = counted();
    blasts.airBurst(AT);
    blasts.impact(AT, true, true, GROUND);
    expect(n.chunks).toBe(0);
    expect(n.glow).toBeGreaterThan(0);
  });

  it('adds a glow card and two to four sparks to a muzzle flash', () => {
    for (let i = 0; i < 20; i++) {
      const { n, blasts } = counted();
      blasts.muzzle(AT, { x: 1, y: 0, z: 0 }, 1);
      expect(n.glow).toBeGreaterThanOrEqual(3);
      expect(n.glow).toBeLessThanOrEqual(5);
    }
  });
});
