import { describe, expect, it } from 'vitest';
import { CHASSIS, type ChassisDef } from './chassis';
import { PARTS, partDef } from './parts';

type Cell = { x: number; y: number };

const ARMOR = 'FBLR';

function letterAt(c: ChassisDef, x: number, y: number): string {
  return c.layout[y]?.[x] ?? ' ';
}

function engineCells(c: ChassisDef): Cell[] {
  return c.layout.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === 'E' ? [{ x, y }] : [])));
}

function coreCells(c: ChassisDef, role: string): Cell[] {
  return c.core.flatMap((core) => {
    const def = partDef(core.defId);
    if (def.kind !== 'core' || def.role !== role) return [];
    const w = core.rot === 1 ? def.h : def.w;
    const h = core.rot === 1 ? def.w : def.h;
    return Array.from({ length: w * h }, (_, i) => ({ x: core.x + (i % w), y: core.y + Math.floor(i / w) }));
  });
}

// The armor letters of the cells next to the given cells.
function armorTouched(c: ChassisDef, cells: Cell[]): Set<string> {
  const touched = new Set<string>();
  for (const { x, y } of cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const letter = letterAt(c, x + dx, y + dy);
      if (ARMOR.includes(letter)) touched.add(letter);
    }
  }
  return touched;
}

// The hood hole of these engines lies on the row behind the front armor row, so the front gap cannot exist.
const FRONT_ENGINE: readonly string[] = ['longbed', 'tractor'];

// Chassis whose tank shares a column with a wheel, with the reason. A stale entry fails the test.
const TANK_BESIDE_WHEELS: Record<string, string> = {
  buggy: 'With the cab and transmission off the wheel columns and the 2x2 deck block kept, a wheel column is the only place left for the tank.',
  courier: 'With the cab and transmission off the wheel columns and the 2x2 deck block kept, a wheel column is the only place left for the tank.',
};

// Chassis with an open 1x2 seat that are not four columns wide, with the reason. A stale entry fails the test.
const SEAT_CAB: Record<string, string> = {
  wagon: 'An open gun platform. On its 6x5 grid a six-cell cab leaves no deck block, which tier 2 requires, and cuts the deck from 11 cells to 6.',
};

// Chassis values before the layout rules. The rules move deck cells, and base makes up the price.
const VALUES = {
  scout: 2444, hauler: 3676, buggy: 1928, wagon: 3022, courier: 2320, van: 3080, longbed: 5384,
  carrier: 4876, tractor: 4382, jeep: 2186, convertible: 2992, bus: 3800, loader: 5088, niva: 3148, bukhanka: 3450, lincoln: 4288,
};

// Chassis with no free 2 by 2 block of deck cells, with the reason. A stale entry fails the test.
const NO_DECK_BLOCK: Record<string, string> = {
  scout: 'A cab clear of the wheels on 5 columns leaves only single deck columns.',
};

const RATED_MASS = 3840; // the scout's rated mass before its cab moved

const columns = (cells: Cell[]) => new Set(cells.map((cell) => cell.x));

describe('chassis grids', () => {
  it('keeps cabs, transmissions and engine bays out of the wheel columns', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const wheels = columns(coreCells(c, 'wheel'));
      const parts = [...coreCells(c, 'cab'), ...coreCells(c, 'transmission'), ...engineCells(c)];
      expect(parts.filter((cell) => wheels.has(cell.x)), id).toEqual([]);
    }
  });

  it('covers the middle column or columns with the transmission', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const inner = c.layout[0].length - 2;
      const middle = inner % 2 ? [1 + (inner - 1) / 2] : [inner / 2, inner / 2 + 1];
      const covered = columns(coreCells(c, 'transmission'));
      expect(middle.every((m) => covered.has(m)), id).toBe(true);
    }
  });

  it('keeps tanks out of the wheel columns but on the chassis listed', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const wheels = columns(coreCells(c, 'wheel'));
      const shared = coreCells(c, 'tank').some((cell) => wheels.has(cell.x));
      expect(shared, id).toBe(id in TANK_BESIDE_WHEELS);
    }
  });

  it('gives four-column chassis and the listed ones the open seat and every other chassis a 3x2 cab', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const seat = c.layout[0].length === 6 || id in SEAT_CAB;
      const cabs = c.core.filter((part) => { const def = partDef(part.defId); return def.kind === 'core' && def.role === 'cab'; });
      expect(cabs.map((part) => part.defId === 'cab'), id).toEqual([seat]);
    }
    for (const id of Object.keys(SEAT_CAB)) expect(CHASSIS[id].layout[0].length, id).not.toBe(6);
  });

  it('keeps every chassis value at its value before the layout rules', () => {
    expect(Object.fromEntries(Object.entries(CHASSIS).map(([id, c]) => [id, c.value]))).toEqual(VALUES);
  });

  it('keeps the scout worth what it was before its cab moved', () => {
    // 800 base plus the modifier of 6 deck cells and 10 armor cells.
    expect(CHASSIS.scout.value).toBe(2444);
    expect(CHASSIS.scout.ratedMass).toBe(RATED_MASS);
  });

  it('keeps the scout grid the same size with the same cells', () => {
    const before = [' FFFFF ', 'LXEEDXR', 'LXEEDXR', 'LXXXDDR', 'LXXXDDR', 'LXXXXXR', 'LXXXXXR', ' BBBBB '];
    const count = (rows: readonly string[]) => {
      const n: Record<string, number> = {};
      for (const ch of rows.join('')) n[ch] = (n[ch] ?? 0) + 1;
      return n;
    };
    expect(CHASSIS.scout.layout.length).toBe(before.length);
    expect(CHASSIS.scout.layout.every((row) => row.length === before[0].length)).toBe(true);
    expect(count(CHASSIS.scout.layout)).toEqual(count(before));
  });

  it('keeps every armor column outside the model and every armor row full width', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const w = c.layout[0].length;
      const last = c.layout.length - 1;
      expect(c.layout[0], id).toBe(` ${'F'.repeat(w - 2)} `);
      expect(c.layout[last], id).toBe(` ${'B'.repeat(w - 2)} `);
      for (const row of c.layout.slice(1, last)) {
        expect(row.length, id).toBe(w);
        expect(row[0] + row[w - 1], id).toBe('LR');
        expect(row.slice(1, -1), id).not.toMatch(/[FBLR ]/);
      }
    }
  });

  it('puts the wheels, two cells long each, one column in from the side armor', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const w = c.layout[0].length;
      const wheels = coreCells(c, 'wheel');
      expect(wheels.map((cell) => cell.x).sort(), id).toEqual([1, 1, 1, 1, w - 2, w - 2, w - 2, w - 2].sort());
    }
  });

  it('marks exactly the cells of the core parts as built-in', () => {
    for (const [id, c] of Object.entries(CHASSIS)) {
      const core = c.core.flatMap((part) => coreCells(c, partDef(part.defId).kind === 'core' ? (partDef(part.defId) as { role: string }).role : ''));
      const marked = c.layout.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === 'X' ? [`${x},${y}`] : [])));
      expect(new Set(core.map((cell) => `${cell.x},${cell.y}`)), id).toEqual(new Set(marked));
    }
  });

  it('lets a tier 2 engine touch armor cells on one side at most', () => {
    for (const [id, c] of Object.entries(CHASSIS).filter(([, ch]) => ch.tier === 2)) {
      expect(armorTouched(c, engineCells(c)).size, id).toBeLessThanOrEqual(1);
    }
  });

  it('keeps a cell that is not armor between every tier 3 critical part and the armor', () => {
    for (const [id, c] of Object.entries(CHASSIS).filter(([, ch]) => ch.tier === 3)) {
      const allowed = FRONT_ENGINE.includes(id) ? new Set(['F']) : new Set<string>();
      expect([...armorTouched(c, engineCells(c))].filter((l) => !allowed.has(l)), `${id} engine`).toEqual([]);
      expect([...armorTouched(c, coreCells(c, 'cab'))], `${id} cab`).toEqual([]);
      expect([...armorTouched(c, coreCells(c, 'tank'))], `${id} tank`).toEqual([]);
    }
  });
});

// True when the layout has a w by h block of cells that carry only the letter D, w across and h along the truck.
function hasDeckBlock(c: ChassisDef, w: number, h: number): boolean {
  for (let y = 0; y + h <= c.layout.length; y++) {
    for (let x = 0; x + w <= c.layout[0].length; x++) {
      const cells = Array.from({ length: w * h }, (_, i) => letterAt(c, x + (i % w), y + Math.floor(i / w)));
      if (cells.every((ch) => ch === 'D')) return true;
    }
  }
  return false;
}

describe('core part sizes', () => {
  const parts = Object.values(PARTS);

  it('sizes every cab 1x2 or 3x2', () => {
    for (const p of parts.filter((d) => d.kind === 'core' && d.role === 'cab')) expect([p.w, p.h].join('x'), p.id).toMatch(/^(1x2|3x2)$/);
  });

  it('gives every transmission 2 by 2 cells', () => {
    for (const p of parts.filter((d) => d.kind === 'core' && d.role === 'transmission')) expect([p.w, p.h], p.id).toEqual([2, 2]);
  });

  it('gives every fuel tank two cells along the truck', () => {
    for (const p of parts.filter((d) => d.kind === 'core' && d.role === 'tank')) expect([p.w, p.h], p.id).toEqual([1, 2]);
  });

  it('gives every engine at least 2 by 2 cells', () => {
    for (const p of parts.filter((d) => d.kind === 'engine')) {
      expect(p.w, p.id).toBeGreaterThanOrEqual(2);
      expect(p.h, p.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives every chassis an engine bay that holds the biggest engine', () => {
    const engines = parts.filter((d) => d.kind === 'engine');
    const w = Math.max(...engines.map((d) => d.w));
    const h = Math.max(...engines.map((d) => d.h));
    for (const [id, c] of Object.entries(CHASSIS)) {
      const bay = new Set(engineCells(c).map((cell) => `${cell.x},${cell.y}`));
      const fits = [...bay].some((key) => {
        const [x, y] = key.split(',').map(Number);
        return Array.from({ length: w * h }, (_, i) => `${x + (i % w)},${y + Math.floor(i / w)}`).every((k) => bay.has(k));
      });
      expect(fits, id).toBe(true);
    }
  });
});

describe('deck blocks for the bigger guns', () => {
  it('keeps a free 2 by 2 block of deck cells on every chassis but those listed', () => {
    for (const [id, c] of Object.entries(CHASSIS)) expect(hasDeckBlock(c, 2, 2), id).toBe(!(id in NO_DECK_BLOCK));
  });

  it('keeps a free 2 across by 3 along block of deck cells on every tier 2 and 3 chassis', () => {
    for (const [id, c] of Object.entries(CHASSIS).filter(([, ch]) => ch.tier >= 2)) expect(hasDeckBlock(c, 2, 3), id).toBe(true);
  });
});

describe('shown cores', () => {
  it('shows the transmission and the tank on the junk-built trucks and hides them on the others', () => {
    const shown = Object.entries(CHASSIS).filter(([, c]) => c.showsCores).map(([id]) => id).sort();
    expect(shown).toEqual(['courier', 'scout', 'wagon']);
  });
});

describe('chassis tradeoffs', () => {
  const count = (c: ChassisDef, letter: string): number => c.layout.reduce((n, row) => n + [...row].filter((ch) => ch === letter).length, 0);
  const armorCells = (c: ChassisDef): number => [...ARMOR].reduce((n, letter) => n + count(c, letter), 0);
  const coreHp = (c: ChassisDef): number => c.core.reduce((n, core) => n + partDef(core.defId).hp, 0);
  const axes = (c: ChassisDef): number[] => [c.maxSpeed, c.accel, c.brake, c.turnSlow, c.turnFast, count(c, 'D'), armorCells(c), c.ratedMass, coreHp(c), c.fuelCap / c.fuelPerTile];

  // True when a is at least as good as b on every stat and better on one.
  function chassisDominates(a: ChassisDef, b: ChassisDef): boolean {
    const x = axes(a);
    const y = axes(b);
    return x.every((v, i) => v >= y[i]) && x.some((v, i) => v > y[i]);
  }

  it('flags a strictly better copy of a chassis', () => {
    const better = { ...CHASSIS.van, maxSpeed: CHASSIS.van.maxSpeed + 1 };
    expect(chassisDominates(better, CHASSIS.van)).toBe(true);
    expect(chassisDominates(CHASSIS.van, better)).toBe(false);
  });

  it('keeps every chassis from issue 149 from matching or beating another of its tier on every stat', () => {
    for (const id of ['lincoln', 'niva', 'bukhanka']) {
      for (const other of Object.values(CHASSIS).filter((c) => c.tier === CHASSIS[id].tier && c.id !== id)) {
        expect(chassisDominates(CHASSIS[id], other), `${id} beats ${other.id}`).toBe(false);
        expect(chassisDominates(other, CHASSIS[id]), `${other.id} beats ${id}`).toBe(false);
        expect(axes(CHASSIS[id]), `${id} matches ${other.id}`).not.toEqual(axes(other));
      }
    }
  });
});
