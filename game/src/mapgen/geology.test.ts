import { describe, expect, it } from "vitest";
import { GEOLOGY } from "../data/terrain";
import type { DuneRules, RainRules, SlumpRules, WindRules } from "../data/terrain";
import { hashRandom } from "../sim/rng";
import { newDraft } from "./bake";
import type { MapDraft } from "./bake";
import { dunes, geologyLayer, rain, slump, wind } from "./geology";

function total(a: Float32Array): number {
  let s = 0;
  for (const v of a) s += v;
  return s;
}

const RAIN_RULES: RainRules = {
  steps: 80,
  rainPerStep: 0.01,
  focusSquarings: 3,
  evaporation: 0.04,
  capacity: 2,
  minSlope: 0.02,
  pickupRate: 0.02,
  dropRate: 0.3,
  maxDig: 0.5,
  spreadPasses: 2,
  spreadRate: 0.2,
};

const UNSPREAD: RainRules = { ...RAIN_RULES, spreadPasses: 0 };

function tiltedPlane(size: number): MapDraft {
  const d = newDraft(size);
  const n = size + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) d.heights[j * n + i] = (size - j) * 0.2 + hashRandom(7, i, j) * 0.05;
  }
  return d;
}

function deepestDip(d: MapDraft, row: number): number {
  const n = d.size + 1;
  const h = (i: number) => d.heights[row * n + i];
  let deepest = 0;
  for (let i = 5; i < n - 5; i++) deepest = Math.max(deepest, (h(i - 3) + h(i + 3)) / 2 - h(i));
  return deepest;
}

describe("rain", () => {
  it("keeps all soil except what water carries off the map edge", () => {
    const d = tiltedPlane(48);
    const before = total(d.heights);

    const outflow = rain(d, RAIN_RULES);

    expect(outflow).toBeGreaterThan(0);
    expect(total(d.heights) + outflow).toBeCloseTo(before, 2);
  });

  it("keeps all soil on rough ground, where erosion lowers corners below neighbors that already drained", () => {
    const d = newDraft(64);
    for (let k = 0; k < d.heights.length; k++) d.heights[k] = hashRandom(7, k) * 3;
    const before = total(d.heights);

    const outflow = rain(d, { ...RAIN_RULES, steps: 20, capacity: 8, pickupRate: 0.3, maxDig: 1 });

    expect(total(d.heights) + outflow).toBeCloseTo(before, 3);
  });

  it("cuts a channel down a tilted plane", () => {
    const d = tiltedPlane(48);
    const row = 36;
    const before = deepestDip(d, row);

    rain(d, UNSPREAD);

    expect(before).toBeLessThan(0.05);
    expect(deepestDip(d, row)).toBeGreaterThan(0.1);
  });

  it("spreads cuts, so no one-tile rill stays deeper than half of what unspread rain leaves", () => {
    const rill = (d: MapDraft, row: number) => {
      const n = d.size + 1;
      let deepest = 0;
      for (let i = 2; i < n - 2; i++) deepest = Math.max(deepest, (d.heights[row * n + i - 1] + d.heights[row * n + i + 1]) / 2 - d.heights[row * n + i]);
      return deepest;
    };
    const spread = tiltedPlane(48);
    const unspread = tiltedPlane(48);

    rain(spread, RAIN_RULES);
    rain(unspread, UNSPREAD);

    expect(rill(spread, 36)).toBeLessThan(rill(unspread, 36) / 2);
  });

  it("gathers flow into lines downhill", () => {
    const d = tiltedPlane(48);
    const n = d.size + 1;
    const row = 40;

    rain(d, UNSPREAD);

    const flows = Array.from(d.flow.subarray(row * n + 2, row * n + n - 2)).sort((a, b) => a - b);
    expect(flows[flows.length - 1]).toBeGreaterThan(flows[flows.length >> 1] * 2.5);
  });
});

function block(size: number): MapDraft {
  const d = newDraft(size);
  const n = size + 1;
  for (let j = 12; j <= 20; j++) {
    for (let i = 12; i <= 20; i++) d.heights[j * n + i] = 4;
  }
  return d;
}

function steepestSlope(d: MapDraft): number {
  const n = d.size + 1;
  let steepest = 0;
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const drop = d.heights[j * n + i] - d.heights[(j + dj) * n + i + di];
          steepest = Math.max(steepest, drop / Math.hypot(di, dj) || 0);
        }
      }
    }
  }
  return steepest;
}

describe("slump", () => {
  const rules: SlumpRules = { steps: 400, restSlope: 0.9, slideShare: 0.5 };

  it("keeps all soil", () => {
    const d = block(32);
    const before = total(d.heights);

    slump(d, rules);

    expect(total(d.heights)).toBeCloseTo(before, 3);
  });

  it("leaves no step above the rest slope", () => {
    const d = block(32);
    expect(steepestSlope(d)).toBeGreaterThan(rules.restSlope);

    slump(d, rules);

    expect(steepestSlope(d)).toBeLessThanOrEqual(rules.restSlope + 1e-3);
  });

  it("marks the corners soil slid from and to, and no others", () => {
    const d = block(32);
    const n = d.size + 1;

    slump(d, rules);

    expect(d.slumped[12 * n + 12]).toBe(1);
    expect(d.slumped[11 * n + 11]).toBe(1);
    expect(d.slumped[2 * n + 2]).toBe(0);
    expect(d.slumped[16 * n + 16]).toBe(0);
  });
});

function sandPatch(): MapDraft {
  const d = newDraft(64);
  const n = d.size + 1;
  for (let j = 24; j <= 40; j++) {
    for (let i = 8; i <= 24; i++) d.sand[j * n + i] = 0.2;
  }
  return d;
}

function centroid(d: MapDraft): { x: number; y: number } {
  const n = d.size + 1;
  let x = 0;
  let y = 0;
  let mass = 0;
  for (let k = 0; k < d.sand.length; k++) {
    x += (k % n) * d.sand[k];
    y += Math.floor(k / n) * d.sand[k];
    mass += d.sand[k];
  }
  return { x: x / mass, y: y / mass };
}

describe("wind", () => {
  const rules: WindRules = {
    direction: 0,
    slab: 0.05,
    hop: 3,
    depositOnSand: 0.6,
    depositOnBare: 0.4,
    shadowSlope: 0.27,
    shadowReach: 8,
    sandSlope: 0.6,
    stepsPerCell: 30,
  };

  it("moves sand downwind", () => {
    const d = sandPatch();
    const start = centroid(d);

    wind(d, rules, { rngState: 5 });

    const end = centroid(d);
    expect(end.x - start.x).toBeGreaterThan(2);
    expect(Math.abs(end.y - start.y)).toBeLessThan(1);
  });

  it("keeps all sand except what blows off the map edge", () => {
    const d = sandPatch();
    const before = total(d.sand);

    const outflow = wind(d, rules, { rngState: 5 });

    expect(total(d.sand) + outflow).toBeCloseTo(before, 3);
  });

  it("adds the sand to corner heights", () => {
    const d = sandPatch();

    wind(d, rules, { rngState: 5 });

    expect(Array.from(d.heights)).toEqual(Array.from(d.sand));
  });

  it("refuses a hop shorter than one tile, which would never leave its corner", () => {
    expect(() => wind(sandPatch(), { ...rules, hop: 0 }, { rngState: 5 })).toThrow(/hop/);
  });

  it("gives the same sand for the same rng state", () => {
    const a = sandPatch();
    const b = sandPatch();

    wind(a, rules, { rngState: 5 });
    wind(b, rules, { rngState: 5 });

    expect(Array.from(a.sand)).toEqual(Array.from(b.sand));
  });
});

function relief(size: number): MapDraft {
  const d = newDraft(size);
  const n = size + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ridge = i > 30 && i < 34 ? 4 : 0;
      d.heights[j * n + i] = -2 + (j / size) * 4 + ridge + hashRandom(3, i, j) * 0.3;
    }
  }
  return d;
}

describe("geologyLayer", () => {
  it("gives identical arrays for the same seed", () => {
    const a = geologyLayer(11, relief(48));
    const b = geologyLayer(11, relief(48));

    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.sand)).toEqual(Array.from(b.sand));
    expect(Array.from(a.flow)).toEqual(Array.from(b.flow));
    expect(Array.from(a.slumped)).toEqual(Array.from(b.slumped));
  });

  it("fills flow and slump marks", () => {
    const d = geologyLayer(11, relief(48));

    expect(Math.max(...d.flow)).toBeGreaterThan(0);
    expect(d.slumped.some((v) => v === 1)).toBe(true);
  });

  it("starts sand only on low ground", () => {
    const high = relief(48);
    const low = relief(48);
    for (let k = 0; k < high.heights.length; k++) {
      high.heights[k] += GEOLOGY.sandStart.below + 10;
      low.heights[k] += GEOLOGY.sandStart.below - GEOLOGY.sandStart.fade - 10;
    }

    geologyLayer(11, high);
    geologyLayer(11, low);

    expect(high.sand.every((v) => v === 0)).toBe(true);
    expect(low.sand.some((v) => v > 0)).toBe(true);
  });
});

const DUNE_RULES: DuneRules = {
  minSand: 0.1,
  fullSand: 0.3,
  maxSlope: 0.15,
  height: 1,
  wavelength: 10,
  leeShare: 0.25,
  bend: 0,
  bendFrequency: 1 / 40,
  bendSeedOffset: 0,
};

function sandSheet(size: number, depth: number): MapDraft {
  const d = newDraft(size);
  d.sand.fill(depth);
  return d;
}

function row(d: MapDraft, y: number): number[] {
  const n = d.size + 1;
  return Array.from({ length: d.size - 1 }, (_, x) => d.heights[y * n + x + 1]);
}

describe("dunes", () => {
  it("raises ridges on deep sand, one per wavelength, as sand", () => {
    const d = sandSheet(40, 0.5);

    dunes(d, DUNE_RULES, 0, 1);

    const heights = row(d, 20);
    const crests = heights.filter((h, x) => x > 0 && x < heights.length - 1 && h > heights[x - 1] && h >= heights[x + 1]);
    expect(crests.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...heights)).toBeGreaterThan(0.7);
    expect(d.sand[20 * 41 + 10]).toBeCloseTo(0.5 + d.heights[20 * 41 + 10]);
  });

  it("drops the lee face steeper than the windward rise", () => {
    const d = sandSheet(40, 0.5);

    dunes(d, DUNE_RULES, 0, 1);

    const steps = row(d, 20).slice(1).map((h, x) => h - row(d, 20)[x]);
    expect(-Math.min(...steps)).toBeGreaterThan(2 * Math.max(...steps));
  });

  it("leaves thin sand flat", () => {
    const d = sandSheet(40, 0.05);

    dunes(d, DUNE_RULES, 0, 1);

    expect(Math.max(...d.heights)).toBe(0);
  });

  it("leaves sand on steep ground flat", () => {
    const d = sandSheet(40, 0.5);
    const n = 41;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) d.heights[j * n + i] = j * 0.3;
    const before = Float32Array.from(d.heights);

    dunes(d, DUNE_RULES, 0, 1);

    expect(Array.from(d.heights)).toEqual(Array.from(before));
  });
});
