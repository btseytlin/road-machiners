"""Green Pit's fortress pieces in the cistern style: corrugated sheet walls backed by stacked water drums and totes
under green tarps, water tanks on steel stilts for towers, and a gate of stacked-container pillars that carry a pipe
and tarp span over chain-link leaves.

Each fort_cistern_<piece>.py script calls run(piece). Geometry helpers come from fort_kit.py.

Sizes, with one tile = 4 m:
- wall: one straight section 8.0 m along X, centered on the origin, 12 m tall, the same on both long faces. A 1.3 m
  corrugated core rises to 12 m, with three courses of drums and totes along each foot and tarps draped over them.
  Everything stays inside 1.45 m of the axis.
- tower: a 6 m footprint centered on the origin, 16 m tall. A tank of 2.6 m radius sits on four steel stilts over a
  solid block of drums and totes, under a shallow dome with a vent pipe.
- gate: 20 m wide along Y, 10 m deep along X and 16 m tall. Its outer face is the plane X = 0 and it faces +X, so the
  origin is the center of the outer face at ground level and the body runs to X = -10. Two pillars of stacked
  containers carry a span of pipes and a green tarp, and chain-link leaves close the opening over a drum bank.
  Nothing reaches past X = 0.
- inner: 4 m deep along X and 10 m wide along Y, centered on the origin, 13 m tall. Two container pillars flank a
  chain-link gate, with a pipe over it. It faces +X like the gate.

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
from shapes import strut, taper  # noqa: E402

WALL_LENGTH = 8.0
WALL_HEIGHT = 12.0
WALL_CORE = 0.65  # half depth of the corrugated core
TOWER_HEIGHT = 16.0
GATE_WIDTH = 20.0
INNER_DEPTH = 4.0
INNER_WIDTH = 10.0
INNER_HEIGHT = 13.0

# Colors from src/render/palette.ts. The green tarp and the teal tank carry the oasis identity.
COLORS = {
    "sheet": 0xB4B4AA,  # a shade over PAL.metalLight, new corrugated sheet
    "sheet_b": 0x8A8A84,  # PAL.metalLight, weathered sheet
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_dark": 0x5E3420,  # PAL.rust.side
    "tarp": 0x4A6A2A,  # PAL.palm, the green tarp
    "tarp_dark": 0x3A5220,  # the tarp in shadow, a shade under PAL.palm
    "tank": 0x4A8A8A,  # PAL.water
    "tank_light": 0x6AAAA0,  # PAL.waterLight
    "drum": 0x2A5A7A,  # a blue drum, between PAL.water and PAL.outline
    "drum_b": 0x8A4A2A,  # PAL.rust.top
    "tote": 0xB8B8B0,  # FACTION_COLORS.convoys.top, a pale tote
    "steel": 0x5A5A58,  # PAL.metal
    "crate": 0x9A7A4A,  # PAL.crate
    "dark": 0x2A2420,  # PAL.wheel
    "soot": 0x1A1410,  # PAL.outline
}

SEEDS = {"wall": 901, "tower": 902, "gate": 903, "inner": 904}


def solid(kit: Kit, name: str, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float, mat: str) -> None:
    """An axis-aligned box from its bounds."""
    extrude(kit, name, rect(x0, x1, y0, y1), rect(x0, x1, y0, y1), z0, z1, mat)


def drum_bank(kit: Kit, name: str, x0: float, x1: float, yc: float, rows: int, r: float = 0.4) -> None:
    """Rows of upright drums standing side by side along X, with a tote in every fifth place."""
    n = int((x1 - x0) / (2 * r))
    step = (x1 - x0) / n
    for row in range(rows):
        for k in range(n):
            x = x0 + (k + 0.5) * step
            z = row * 0.95 + 0.45
            if (k + row * 2) % 5 == 4:
                kit.box(f"{name}_tote{row}_{k}", (step - 0.06, 2 * r - 0.06, 0.9), (x, yc, z), "tote", dent_by=0.02)
            else:
                kit.cylinder(f"{name}_drum{row}_{k}", r, 0.9, (x, yc, z), kit.rng.choice(("drum", "drum", "drum_b", "tank")), vertices=8)


def tarp(kit: Kit, name: str, x: float, y_wall: float, y_out: float, z_low: float, z_high: float, width: float) -> None:
    """A tarp sheet sloping from the wall at z_high down over the drums to z_low at y_out."""
    rise, run = z_high - z_low, abs(y_out - y_wall)
    tilt = math.atan2(rise, run) * (1 if y_out > y_wall else -1)
    kit.box(name, (width, math.hypot(rise, run), 0.06), (x, (y_wall + y_out) / 2, (z_low + z_high) / 2), kit.rng.choice(("tarp", "tarp", "tarp_dark")), rot=(tilt, 0, 0), dent_by=0.03)


def wall(kit: Kit) -> None:
    """One 8 m wall section: a corrugated core, drums and totes along both feet, and tarps over them."""
    h = WALL_LENGTH / 2
    solid(kit, "wall_core", -h, h, -WALL_CORE, WALL_CORE, -SKIRT, WALL_HEIGHT - 0.2, "sheet_b")
    n = int(WALL_LENGTH / 0.4)
    for sign in (-1, 1):
        for k in range(n):
            x = -h + (k + 0.5) * WALL_LENGTH / n
            kit.box(f"wall_rib{sign}_{k}", (0.2, 0.1, WALL_HEIGHT - 3.4), (x, sign * (WALL_CORE + 0.04), (WALL_HEIGHT + 3.4) / 2 - 0.1), "sheet" if k % 2 else "sheet_b")
        for k in range(3):
            x = -h + (k + 0.5) * WALL_LENGTH / 3
            kit.box(f"wall_patch{sign}_{k}", (kit.rng.uniform(1.4, 2.2), 0.08, kit.rng.uniform(1.4, 2.4)), (x + kit.rng.uniform(-0.3, 0.3), sign * (WALL_CORE + 0.1), kit.rng.uniform(5.5, 9.5)),
                    kit.rng.choice(("rust", "rust_dark", "sheet")), rot=(0, kit.rng.uniform(-0.1, 0.1), 0), dent_by=0.03)
        drum_bank(kit, f"wall_bank{sign}", -h + 0.1, h - 0.1, sign * (WALL_CORE + 0.4), 3)
        for k in range(2):
            tarp(kit, f"wall_tarp{sign}_{k}", -h + 2.0 + k * 4.0, sign * (WALL_CORE + 0.05), sign * (WALL_CORE + 0.8), 2.8, 5.4, 3.0)
        kit.box(f"wall_rail{sign}", (WALL_LENGTH, 0.3, 0.25), (0, sign * 0.25, WALL_HEIGHT - 0.1), "steel")
    for k in range(3):
        x = -h + 1.0 + k * 3.0
        strut(kit, f"wall_pipe{k}", (x, 0.0, WALL_HEIGHT - 0.2), (x + 0.3, 0.0, WALL_HEIGHT + 0.0), 0.2, "steel", sides=6)


def tower(kit: Kit) -> None:
    """A tank on four steel stilts over a solid block of drums and totes, with a shallow dome and a vent pipe."""
    solid(kit, "tower_store", -2.6, 2.6, -2.6, 2.6, -SKIRT, 3.0, "sheet_b")
    for sx in (-1, 1):
        for sy in (-1, 1):
            n = 4
            for k in range(n):
                kit.cylinder(f"tower_drum{sx}{sy}_{k}", 0.42, 2.4, (sx * (2.0 if k % 2 else 1.0) * 1.25, sy * (1.0 if k < 2 else 2.0) * 1.25, 1.3), kit.rng.choice(("drum", "drum_b", "tank")), vertices=8)
    for k, (x, y) in enumerate(((-1.9, -1.9), (1.9, -1.9), (1.9, 1.9), (-1.9, 1.9))):
        strut(kit, f"tower_stilt{k}", (x, y, 2.8), (x * 0.95, y * 0.95, 9.4), 0.4, "steel", sides=6)
    for z in (5.0, 7.4):
        for a in (-1.9, 1.9):
            strut(kit, f"tower_tie_x{z}_{a}", (-1.9, a, z), (1.9, a, z), 0.15, "steel")
            strut(kit, f"tower_tie_y{z}_{a}", (a, -1.9, z), (a, 1.9, z), 0.15, "steel")
    for k, (x0, y0, x1, y1) in enumerate(((-1.9, -1.9, 1.9, 1.9), (1.9, -1.9, -1.9, 1.9))):
        strut(kit, f"tower_cross{k}", (x0, y0, 3.2), (x1, y1, 9.0), 0.14, "steel")
    kit.cylinder("tower_floor", 2.55, 0.3, (0, 0, 9.5), "steel", vertices=14)
    kit.cylinder("tower_tank", 2.6, 4.6, (0, 0, 12.0), "tank", vertices=14)
    for z in (10.6, 12.0, 13.4):
        kit.cylinder(f"tower_hoop{z}", 2.66, 0.18, (0, 0, z), "steel", vertices=14)
    kit.cylinder("tower_stain", 2.64, 1.4, (0, 0, 11.0), "tank_light", vertices=14)
    dome = kit.cylinder("tower_dome", 2.6, 1.0, (0, 0, 14.8), "sheet", vertices=14)
    taper(dome, 0.45, 1.0)
    kit.cylinder("tower_vent", 0.22, 1.4, (0.0, 0.0, 15.4), "steel", vertices=6)
    kit.cylinder("tower_vent_cap", 0.4, 0.2, (0.0, 0.0, 15.9), "steel", vertices=6)
    kit.box("tower_tarp", (3.4, 3.0, 0.08), (0.0, 0.8, 14.4), "tarp", rot=(0.55, 0.0, 0.0), dent_by=0.03)
    for k in range(10):
        kit.box(f"tower_rung{k}", (0.08, 0.6, 0.08), (2.42, -0.2, 3.4 + k * 0.62), "steel")
    strut(kit, "tower_ladder", (2.42, -0.5, 3.0), (2.42, -0.5, 9.5), 0.1, "steel")


def _pillar(kit: Kit, name: str, y0: float, y1: float) -> None:
    """A pillar of three stacked containers, each turned a little, with corrugation ribs."""
    mid = (y0 + y1) / 2
    levels = ((-SKIRT, 5.0, 0.0, "rust_dark"), (5.0, 9.8, math.radians(3), "sheet_b"), (9.8, 14.6, math.radians(-4), "rust"))
    for k, (z0, z1, yaw, mat) in enumerate(levels):
        w, d = y1 - y0 - 0.5 - 0.2 * k, 9.2 - 0.3 * k
        c, s = math.cos(yaw), math.sin(yaw)
        poly = [(-5.0 + px * c - py * s, mid + px * s + py * c) for px, py in rect(-d / 2, d / 2, -w / 2, w / 2)]
        extrude(kit, f"{name}_box{k}", poly, poly, z0, z1, mat)
        for r in range(7):
            kit.box(f"{name}_rib{k}_{r}", (0.12, 0.2, z1 - max(z0, 0) - 0.4), (-0.12 - 0.0 * r, mid - w / 2 + 0.3 + r * (w - 0.6) / 6, (max(z0, 0) + z1) / 2), "sheet" if r % 2 else mat)
    kit.box(f"{name}_corner", (0.3, 0.3, 14.6), (-0.2, y0 + 0.3, 7.3), "steel")
    kit.box(f"{name}_corner2", (0.3, 0.3, 14.6), (-0.2, y1 - 0.3, 7.3), "steel")
    solid(kit, f"{name}_cap", -9.4, -0.3, y0 + 0.1, y1 - 0.1, 14.6, 14.9, "steel")
    for k, x in enumerate((-2.0, -7.0)):
        kit.cylinder(f"{name}_vent{k}", 0.25, 1.4, (x, mid, 15.6), "steel", vertices=6)


def chain_leaf(kit: Kit, name: str, x: float, y0: float, y1: float, height: float) -> None:
    """A chain-link leaf: a steel frame, a mesh plane and two diagonal braces."""
    w = y1 - y0
    yc = (y0 + y1) / 2
    kit.box(f"{name}_mesh", (0.16, w, height), (x, yc, height / 2), "sheet", dent_by=0.02)
    for k in range(int(w / 0.5)):
        kit.box(f"{name}_wire{k}", (0.22, 0.05, height), (x, y0 + 0.25 + k * 0.5, height / 2), "steel")
    for z in (0.1, height / 2, height - 0.1):
        kit.box(f"{name}_bar{z}", (0.3, w, 0.2), (x, yc, z), "steel")
    for flip in (-1, 1):
        strut(kit, f"{name}_diag{flip}", (x - 0.1, y0 + 0.2, 0.3 if flip < 0 else height - 0.3), (x - 0.1, y1 - 0.2, height - 0.3 if flip < 0 else 0.3), 0.14, "steel")


def gate(kit: Kit) -> None:
    """Two container pillars carry a pipe and tarp span over chain-link leaves and a drum bank."""
    hw = GATE_WIDTH / 2
    inner = hw - 5.5
    _pillar(kit, "gate_pillar_n", inner, hw)
    _pillar(kit, "gate_pillar_s", -hw, -inner)
    solid(kit, "gate_fill", -9.4, -1.6, -inner, inner, -SKIRT, 3.2, "sheet_b")
    drum_bank(kit, "gate_fill_bank", -9.0, -2.0, 0.0, 3, 0.4)
    for k, z in enumerate((13.3, 14.3)):
        kit.cylinder(f"gate_span{k}", 0.38, 2 * hw - 1.0, (-2.4 - 2.2 * k, 0.0, z), "steel", rot=(math.pi / 2, 0, 0), vertices=8)
    kit.box("gate_tarp", (3.4, 2 * inner - 0.4, 0.08), (-4.0, 0.0, 12.4), "tarp", rot=(0, 0.35, 0), dent_by=0.04)
    kit.box("gate_tarp2", (3.0, 2 * inner - 1.6, 0.08), (-6.5, 0.0, 12.2), "tarp_dark", rot=(0, -0.3, 0), dent_by=0.04)
    kit.box("gate_header", (0.6, 2 * inner, 0.8), (-0.5, 0.0, 8.0), "rust_dark")
    chain_leaf(kit, "gate_leaf_l", -1.0, -inner + 0.1, -0.05, 7.6)
    chain_leaf(kit, "gate_leaf_r", -1.0, 0.05, inner - 0.1, 7.6)
    kit.box("gate_chain", (0.3, 0.3, 0.3), (-0.8, 0.0, 3.5), "dark")
    kit.box("gate_seam", (0.44, 0.1, 7.6), (-1.0, 0.0, 3.8), "soot")


def inner(kit: Kit) -> None:
    """The inner gate: two container pillars flank a chain-link gate, with a pipe over it."""
    hd, hw = INNER_DEPTH / 2, INNER_WIDTH / 2
    for sign in (-1, 1):
        y = sign * (hw - 1.0)
        solid(kit, f"inner_pillar{sign}", -hd - 0.2, hd + 0.2, y - 1.0, y + 1.0, -SKIRT, INNER_HEIGHT, "rust_dark" if sign < 0 else "sheet_b")
        for z in (3.6, 7.2, 10.8):
            solid(kit, f"inner_pillar_band{sign}_{z}", -hd - 0.2, hd + 0.2, y - 1.0, y + 1.0, z, z + 0.3, "steel")
        for r in range(4):
            kit.box(f"inner_pillar_rib{sign}_{r}", (0.1, 0.18, INNER_HEIGHT - 1.5), (hd + 0.2, y - 0.7 + r * 0.46, INNER_HEIGHT / 2), "sheet")
    inner_half = hw - 2.0
    solid(kit, "inner_bank_core", -1.6, 1.6, -inner_half, inner_half, -SKIRT, 3.0, "sheet_b")
    drum_bank(kit, "inner_bank", -1.4, 1.4, 0.0, 3, 0.35)
    for face, x in ((1, hd - 0.5), (-1, -hd + 0.5)):
        chain_leaf(kit, f"inner_leaf{face}_l", x, -inner_half, -0.05, 6.4)
        chain_leaf(kit, f"inner_leaf{face}_r", x, 0.05, inner_half, 6.4)
    kit.cylinder("inner_pipe", 0.35, 2 * hw - 1.2, (0.0, 0.0, INNER_HEIGHT - 1.0), "steel", rot=(math.pi / 2, 0, 0), vertices=8)
    kit.box("inner_tarp", (2.4, 2 * inner_half, 0.08), (0.0, 0.0, 8.2), "tarp", rot=(0, 0.2, 0), dent_by=0.03)


PIECES: dict[str, tuple[Callable[[Kit], None], float]] = {
    "wall": (wall, 34),
    "tower": (tower, 36),
    "gate": (gate, 46),
    "inner": (inner, 38),
}


def run(piece: str) -> None:
    """Builds fort_cistern_<piece> and exports it with an optional preview, from the script's command line."""
    if piece not in PIECES:
        raise KeyError(f"unknown fort piece {piece!r}. Known: {sorted(PIECES)}")
    args = parse_args()
    kit = Kit(COLORS, SEEDS[piece])
    build, view = PIECES[piece]
    build(kit)
    kit.export(f"fort_cistern_{piece}", args, view_size=view)
