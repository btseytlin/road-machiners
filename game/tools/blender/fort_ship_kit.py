"""Nose's fortress pieces in the ship metal style (C5): a curtain of colored riveted ship panels under a dark band of
white diamonds with a timber walkway, octagonal banded towers with lit top storeys and two antennae, and a gate of
shut X-braced plank doors between two built-in towers, joined by a plated catwalk that carries the gate gun.

Each fort_ship_<piece>.py script calls run(piece). Geometry helpers come from fort_kit.py.

Sizes, with one tile = 4 m:
- wall: one straight section 8.0 m along X, centered on the origin, 16 m tall to its rail and 2.8 m deep. Two 4 m
  panels per face repeat within the module, so the game may stretch it along X. +Y faces out of the site, since the
  layout lays walls counterclockwise: the diamond band is on the +Y face, the timber walkway's rail and props on the
  -Y (inner) side.
- tower: an octagon inside the 6 m footprint centered on the origin, 22 m tall to its roof, with two antennae above.
- gate: 24 m wide along Y, 6 m deep along X and 18 m tall to its catwalk rail. Its outer face is the plane X = 0 and it faces +X, so the
  origin is the center of the outer face at ground level and the body runs to X = -6. Shut doors 12 m wide and 11 m
  high stand in a steel frame between two octagonal towers centered at Y = -9 and +9. No lamps: the gate furniture
  owns them. Nothing reaches past X = 0 (no flare).

Every piece has a skirt to 1.2 m below its ground point, so it never floats on uneven ground.
Faces are kept just inside 0.5 m collision cells, so face detail does not widen the collider (scripts/shape-lib.mjs).
"""

from __future__ import annotations

import math
import sys
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fort_kit import SKIRT, extrude, rect  # noqa: E402
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

XY = tuple[float, float]

WALL_LENGTH = 8.0
WALL_HALF_DEPTH = 1.3
WALL_HEIGHT = 16.0
DECK = 14.4  # the walkway floor and the band's top
BAND = (12.8, DECK)  # the diamond band on the outer face
TOWER_R = 2.9  # octagon corner radius; the faces lie 2.68 m from the center
TOWER_BANDS = 6
STOREY = 17.4  # where the dark top storey starts
TOWER_ROOF = 22.0
GATE_WIDTH = 24.0
GATE_DEPTH = 6.0
GATE_HEIGHT = 18.0
DOOR_HALF = 6.0
DOOR_TOP = 13.0
GATE_TOWER_Y = 9.0

# Colors from src/render/palette.ts. C5's panels are pale grey, rust red, slate blue and dark grey.
COLORS = {
    "pale": 0xB8B8B0,  # FACTION_COLORS.convoys.top
    "rust": 0x8A3A2A,  # PAL.roof[2]
    "slate": 0x5E7A8A,  # FACTION_COLORS.traders.top
    "dark": 0x5A6068,  # FACTION_COLORS.mercs.cab
    "core": 0x3E4248,  # FACTION_COLORS.mercs.cabSide, seams and the core
    "band": 0x2A2A2C,  # FACTION_COLORS.mercs.top, the diamond band and the dark tower bands
    "diamond": 0xF0E0B8,  # PAL.plan
    "seam": 0x86867E,  # FACTION_COLORS.convoys.side, rivet lines on the panels
    "timber": 0x6A4A2A,  # PAL.trunk
    "plank": 0x9A7A4A,  # PAL.crate
    "door": 0x7A6A4A,  # FACTION_COLORS.scavengers.top, weathered gate planks
    "steel": 0x5A5A58,  # PAL.metal
    "glow": 0xFFF2C8,  # PAL.lamp.on
}

SEEDS = {"wall": 201, "tower": 202, "gate": 203}


def solid(kit: Kit, name: str, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float, mat: str) -> None:
    """An axis-aligned box from its bounds."""
    extrude(kit, name, rect(x0, x1, y0, y1), rect(x0, x1, y0, y1), z0, z1, mat)


def octagon(at: XY, r: float) -> list[XY]:
    """A counterclockwise octagon with corner radius r whose faces look along the axes and the diagonals."""
    return [(at[0] + r * math.cos(math.pi / 8 + k * math.pi / 4), at[1] + r * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]


# --- Wall -----------------------------------------------------------------------------------------------------


def _panels(kit: Kit, name: str, sign: int, mats: tuple[str, str], top: float) -> None:
    """Two 4 m riveted panels on one long face, with rivet lines along their edges and across their middle."""
    y = sign * (WALL_HALF_DEPTH + 0.04)
    for i, mat in enumerate(mats):
        x = -WALL_LENGTH / 2 + (i + 0.5) * 4.0
        kit.box(f"{name}_panel{i}", (3.92, 0.08, top + 0.2), (x, y, (top - 0.2) / 2), mat, dent_by=0.015)
        yo = sign * (WALL_HALF_DEPTH + 0.09)
        for k, z in enumerate((0.6, top / 2, top - 0.4)):
            kit.box(f"{name}_rivets{i}_{k}", (3.6, 0.04, 0.08), (x, yo, z), "seam")
        for k, dx in enumerate((-1.75, 1.75)):
            kit.box(f"{name}_edge{i}_{k}", (0.08, 0.04, top - 0.6), (x + dx, yo, top / 2), "seam")


def _diamond_band(kit: Kit, name: str, x0: float, x1: float, y: float, sign: int, z0: float, z1: float, along_y: bool = False) -> None:
    """A dark band with white diamond plates along a face at y (or at X = y when along_y), facing sign."""
    count = max(1, round((x1 - x0) / 1.0))
    a, b = sorted((y, y + sign * 0.08))
    zc = (z0 + z1) / 2
    size = (z1 - z0) * 0.48
    if along_y:
        solid(kit, f"{name}_band", a, b, x0, x1, z0, z1, "band")
    else:
        solid(kit, f"{name}_band", x0, x1, a, b, z0, z1, "band")
    for i in range(count):
        u = x0 + (i + 0.5) * (x1 - x0) / count
        d = y + sign * 0.1
        if along_y:
            kit.box(f"{name}_diamond{i}", (0.06, size, size), (d, u, zc), "diamond", rot=(math.pi / 4, 0, 0))
        else:
            kit.box(f"{name}_diamond{i}", (size, 0.06, size), (u, d, zc), "diamond", rot=(0, math.pi / 4, 0))


def _rail(kit: Kit, name: str, y: float, x0: float, x1: float, z0: float, z1: float, posts: list[float]) -> None:
    """A timber rail along X at y: posts from z0 to z1 with a top and a middle rail."""
    for k, x in enumerate(posts):
        solid(kit, f"{name}_post{k}", x - 0.09, x + 0.09, y - 0.09, y + 0.09, z0, z1, "timber")
    solid(kit, f"{name}_top", x0, x1, y - 0.07, y + 0.07, z1 - 0.14, z1, "timber")
    solid(kit, f"{name}_mid", x0, x1, y - 0.05, y + 0.05, (z0 + z1) / 2 - 0.05, (z0 + z1) / 2 + 0.05, "plank")


def wall(kit: Kit) -> None:
    """One 8 m wall section: colored panels on both faces, a diamond band on the outer top, a timber walkway with a
    rail, and timber props on the inner face."""
    h, d = WALL_LENGTH / 2, WALL_HALF_DEPTH
    solid(kit, "wall_core", -h, h, -d, d, -SKIRT, DECK, "core")
    _panels(kit, "wall_out", 1, ("slate", "pale"), BAND[0])
    _panels(kit, "wall_in", -1, ("rust", "dark"), DECK - 0.3)
    _diamond_band(kit, "wall", -h, h, d, 1, *BAND)
    for k in range(8):
        x = -h + (k + 0.5)
        solid(kit, f"wall_plank{k}", x - 0.47, x + 0.47, -d - 0.1, d, DECK, DECK + 0.14, "timber")
    _rail(kit, "wall_rail_in", -d - 0.05, -h, h, DECK + 0.14, WALL_HEIGHT, [-3.0, -1.0, 1.0, 3.0])
    _rail(kit, "wall_rail_out", d - 0.12, -h, h, DECK + 0.14, WALL_HEIGHT - 0.2, [-2.0, 2.0])
    # Timber props on the inner face: an upright and a raking brace under the walkway, as in C5.
    y = -d - 0.12
    for k, x in enumerate((-2.0, 2.0)):
        solid(kit, f"wall_prop{k}", x - 0.11, x + 0.11, y - 0.06, y + 0.06, 0.0, DECK, "timber")
        strut(kit, f"wall_prop{k}_brace", (x + 1.6, y, 0.2), (x + 0.1, y, 7.5), 0.12, "timber")


# --- Tower ----------------------------------------------------------------------------------------------------


def _octagon_tower(kit: Kit, name: str, at: XY, antennae: tuple[float, float]) -> None:
    """An octagonal tower in alternating pale and dark bands, a dark top storey with lit windows, a cornice, a flat
    roof and two antennae reaching the given heights."""
    core = octagon(at, TOWER_R - 0.12)
    extrude(kit, f"{name}_core", core, core, -SKIRT, STOREY, "core")
    step = STOREY / TOWER_BANDS
    for k in range(TOWER_BANDS):
        poly = octagon(at, TOWER_R - (0.02 if k % 2 == 0 else 0.07))
        z0 = -SKIRT if k == 0 else k * step
        extrude(kit, f"{name}_band{k}", poly, poly, z0, (k + 1) * step, "pale" if k % 2 == 0 else "band")
    storey = octagon(at, TOWER_R - 0.1)
    extrude(kit, f"{name}_storey", storey, storey, STOREY, TOWER_ROOF - 0.9, "band")
    # Lit windows on the four axis faces, small dark ports on the diagonals.
    apothem = (TOWER_R - 0.1) * math.cos(math.pi / 8)
    for k in range(8):
        a = k * math.pi / 4
        x, y = at[0] + math.cos(a) * (apothem + 0.03), at[1] + math.sin(a) * (apothem + 0.03)
        mat, size = ("glow", (0.08, 0.9, 1.0)) if k % 2 == 0 else ("core", (0.08, 0.5, 0.7))
        kit.box(f"{name}_window{k}", size, (x, y, (STOREY + TOWER_ROOF - 0.9) / 2), mat, rot=(0, 0, a))
        if k % 2 == 1:
            xs, ys = at[0] + math.cos(a) * (TOWER_R * math.cos(math.pi / 8) + 0.0), at[1] + math.sin(a) * (TOWER_R * math.cos(math.pi / 8) + 0.0)
            kit.box(f"{name}_port{k}", (0.06, 0.4, 0.8), (xs, ys, step * 3.5), "core", rot=(0, 0, a))
    cornice = octagon(at, TOWER_R)
    extrude(kit, f"{name}_cornice", cornice, cornice, TOWER_ROOF - 0.9, TOWER_ROOF - 0.5, "pale")
    roof = octagon(at, TOWER_R - 0.3)
    extrude(kit, f"{name}_roof", roof, octagon(at, TOWER_R - 0.8), TOWER_ROOF - 0.5, TOWER_ROOF, "band")
    for k, (dx, dy, top) in enumerate(((-0.6, 0.5, antennae[0]), (0.7, -0.4, antennae[1]))):
        strut(kit, f"{name}_antenna{k}", (at[0] + dx, at[1] + dy, TOWER_ROOF - 0.2), (at[0] + dx, at[1] + dy, top), 0.1, "steel", sides=5)
        kit.box(f"{name}_antenna{k}_bar", (0.06, 0.6, 0.06), (at[0] + dx, at[1] + dy, top - 0.8), "steel")


def tower(kit: Kit) -> None:
    """An octagonal banded tower, 22 m to its roof."""
    _octagon_tower(kit, "tower", (0.0, 0.0), (25.4, 24.2))


# --- Gate -----------------------------------------------------------------------------------------------------


def _plank_leaf(kit: Kit, name: str, x: float, y0: float, y1: float, z1: float) -> None:
    """A shut plank leaf with its outer face at x: vertical planks, a frame and an X brace."""
    solid(kit, f"{name}_back", x - 0.4, x - 0.1, y0, y1, 0.0, z1, "timber")
    n = 8
    for i in range(n):
        a = y0 + (y1 - y0) * i / n
        b = y0 + (y1 - y0) * (i + 1) / n
        solid(kit, f"{name}_plank{i}", x - 0.1, x - 0.02, a + 0.03, b - 0.03, 0.0, z1, "door" if i % 3 else "timber")
    t = 0.35
    for k, (a0, a1, b0, b1) in enumerate(((y0, y1, 0.2, 0.2 + t), (y0, y1, z1 - t, z1), (y0, y0 + t, 0.0, z1), (y1 - t, y1, 0.0, z1), (y0, y1, z1 / 2 - t / 2, z1 / 2 + t / 2))):
        solid(kit, f"{name}_frame{k}", x - 0.04, x + 0.06, a0, a1, b0, b1, "timber")
    for k, (za, zb) in enumerate(((0.2 + t, z1 / 2 - t / 2), (z1 / 2 + t / 2, z1 - t))):
        strut(kit, f"{name}_x{k}a", (x + 0.02, y0 + t, za), (x + 0.02, y1 - t, zb), 0.22, "timber")
        strut(kit, f"{name}_x{k}b", (x + 0.02, y1 - t, za), (x + 0.02, y0 + t, zb), 0.22, "timber")


def gate(kit: Kit) -> None:
    """Two octagonal towers flank shut X-braced plank doors in a steel frame, under a plated catwalk."""
    cx = -GATE_DEPTH / 2
    for sign in (-1, 1):
        _octagon_tower(kit, f"gate_tower{sign}", (cx, sign * GATE_TOWER_Y), (24.2, 23.4))
        # A steel post fills between the door frame and the tower.
        y0, y1 = sorted((sign * (DOOR_HALF - 0.1), sign * (GATE_TOWER_Y - 2.0)))
        solid(kit, f"gate_post{sign}", -GATE_DEPTH + 0.4, -0.3, y0, y1, -SKIRT, DOOR_TOP + 1.2, "steel")
    front = -0.6
    _plank_leaf(kit, "gate_l", front, -DOOR_HALF, -0.04, DOOR_TOP)
    _plank_leaf(kit, "gate_r", front, 0.04, DOOR_HALF, DOOR_TOP)
    solid(kit, "gate_seam", front - 0.45, front - 0.05, -0.05, 0.05, 0.0, DOOR_TOP, "core")
    # The steel frame head and the plated catwalk joining the tower tops, under the gate gun.
    solid(kit, "gate_head", -1.4, -0.3, -DOOR_HALF - 0.1, DOOR_HALF + 0.1, DOOR_TOP, DOOR_TOP + 1.2, "steel")
    solid(kit, "gate_catwalk", -GATE_DEPTH + 0.6, -0.4, -GATE_TOWER_Y + 1.5, GATE_TOWER_Y - 1.5, DOOR_TOP + 1.2, 16.6, "core")
    plates = 6
    width = 2 * (GATE_TOWER_Y - 2.4) / plates
    for i in range(plates):
        y = -(GATE_TOWER_Y - 2.4) + (i + 0.5) * width
        solid(kit, f"gate_catwalk_plate{i}", -0.4, -0.32, y - width / 2 + 0.05, y + width / 2 - 0.05, DOOR_TOP + 1.3, 16.0, ("pale", "dark", "slate")[i % 3])
    _diamond_band(kit, "gate_catwalk", -(GATE_TOWER_Y - 2.4), GATE_TOWER_Y - 2.4, -0.32, 1, 16.0, 16.6, along_y=True)
    solid(kit, "gate_deck", -GATE_DEPTH + 0.5, -0.3, -GATE_TOWER_Y + 1.5, GATE_TOWER_Y - 1.5, 16.6, 16.8, "steel")
    for k, x in enumerate((-0.45, -GATE_DEPTH + 0.65)):
        for j in range(5):
            y = -(GATE_TOWER_Y - 2.4) + j * (GATE_TOWER_Y - 2.4) / 2
            solid(kit, f"gate_rail_post{k}_{j}", x - 0.06, x + 0.06, y - 0.06, y + 0.06, 16.8, 17.9, "steel")
        solid(kit, f"gate_rail{k}", x - 0.05, x + 0.05, -(GATE_TOWER_Y - 2.4), GATE_TOWER_Y - 2.4, 17.8, 17.9, "steel")


PIECES: dict[str, tuple[Callable[[Kit], None], float]] = {
    "wall": (wall, 18),
    "tower": (tower, 40),
    "gate": (gate, 44),
}


def run(piece: str) -> None:
    """Builds fort_ship_<piece> and exports it with an optional preview, from the script's command line."""
    if piece not in PIECES:
        raise KeyError(f"unknown ship piece {piece!r}. Known: {sorted(PIECES)}")
    args = parse_args()
    kit = Kit(COLORS, SEEDS[piece])
    build, view = PIECES[piece]
    build(kit)
    kit.export(f"fort_ship_{piece}", args, view_size=view)
