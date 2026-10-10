"""Pump Station's fortress pieces in the pumpworks style: riveted rust plate with pipe runs, square pressure
housings and a pipe-gantry gate, on a concrete footing with a rubble apron. It is built in Salvage Yard's material
family and has no parapet rhythm, round drums or arches.

Each fort_pumpworks_<piece>.py script calls run(piece). Geometry helpers come from fort_kit.py.

Sizes, with one tile = 4 m:
- wall: one straight section 8.0 m along X, centered on the origin, 12 m tall, the same on both long faces. A 1.9 m
  plate core carries four riveted panels per face, two pipe runs with flanges and brackets, and a flat capping pipe.
  The pipes stay inside 1.45 m of the axis.
- tower: a 6 m footprint centered on the origin, 16 m tall. A square riveted housing on a concrete plinth carries a
  manifold of pipe spools and a valve wheel on its +X face, a flat roof and two vent stacks.
- gate: 20 m wide along Y, 10 m deep along X and 16 m tall. Its outer face is the plane X = 0 and it faces +X, so the
  origin is the center of the outer face at ground level and the body runs to X = -10. Two riveted gantry legs carry
  an overhead bridge of three pipes over a plate block, and sliding plate doors hang on a rail in the opening.
  Nothing reaches past X = 0.
- inner: 4 m deep along X and 10 m wide along Y, centered on the origin, 13 m tall. Two riveted posts hold a rack of
  stacked pipes between them. It faces +X like the gate.

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
WALL_CORE = 0.95  # half depth of the plate core
TOWER_HEIGHT = 16.0
GATE_WIDTH = 20.0
GATE_DEPTH = 10.0
INNER_DEPTH = 4.0
INNER_WIDTH = 10.0
INNER_HEIGHT = 13.0

# Colors from src/render/palette.ts, the Salvage Yard family: rust plate and concrete over broken rock.
COLORS = {
    "plate": 0x8A4A2A,  # PAL.rust.top
    "plate_b": 0x5E3420,  # PAL.rust.side
    "plate_c": 0x7A4630,  # between PAL.rust.top and PAL.rust.side
    "rust": 0xA05C38,  # a shade over PAL.rust.top, the lit plate
    "concrete": 0xB8B8B0,  # FACTION_COLORS.convoys.top
    "concrete_b": 0x9A8A78,  # PAL.rock.top
    "pipe": 0x5A5A58,  # PAL.metal
    "pipe_light": 0x8A8A84,  # PAL.metalLight
    "valve": 0x8E2E22,  # FACTION_COLORS.raiders.top, the red wheel
    "slit": 0x1A1410,  # PAL.outline
    "rubble": 0x4E453C,  # PAL.rock.dark
    "rubble_b": 0x6E6254,  # PAL.rock.side
}

SEEDS = {"wall": 801, "tower": 802, "gate": 803, "inner": 804}


def solid(kit: Kit, name: str, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float, mat: str) -> None:
    """An axis-aligned box from its bounds."""
    extrude(kit, name, rect(x0, x1, y0, y1), rect(x0, x1, y0, y1), z0, z1, mat)


def pipe_x(kit: Kit, name: str, x0: float, x1: float, y: float, z: float, r: float, mat: str = "pipe") -> None:
    """A pipe along X from x0 to x1."""
    kit.cylinder(name, r, x1 - x0, ((x0 + x1) / 2, y, z), mat, rot=(0, math.pi / 2, 0), vertices=8)


def pipe_y(kit: Kit, name: str, y0: float, y1: float, x: float, z: float, r: float, mat: str = "pipe") -> None:
    """A pipe along Y from y0 to y1."""
    kit.cylinder(name, r, y1 - y0, (x, (y0 + y1) / 2, z), mat, rot=(math.pi / 2, 0, 0), vertices=8)


def rivets(kit: Kit, name: str, x0: float, x1: float, y: float, z0: float, z1: float, out: float) -> None:
    """Rows of rivet strips on a plate face at y: thin vertical ribs every 0.8 m between x0 and x1."""
    n = max(1, int((x1 - x0) / 0.8))
    for k in range(n + 1):
        x = x0 + (x1 - x0) * k / n
        kit.box(f"{name}{k}", (0.12, out * 2, z1 - z0), (x, y, (z0 + z1) / 2), "plate_b")


def apron(kit: Kit, name: str, sign: int, count: int, reach: float, span: float) -> None:
    """Broken rock and concrete chunks along one foot of a wall, between the core and `reach` meters out."""
    for i in range(count):
        s = kit.rng.uniform(0.35, 0.6)
        x = kit.rng.uniform(-span, span)
        y = sign * kit.rng.uniform(WALL_CORE + 0.05, reach - s * 0.75)
        kit.box(f"{name}{i}", (s, s * 0.8, s * 0.7), (x, y, kit.rng.uniform(0.0, 0.5)), kit.rng.choice(("rubble", "rubble_b", "rubble")),
                rot=(kit.rng.uniform(-0.4, 0.4), kit.rng.uniform(-0.4, 0.4), kit.rng.uniform(0, math.pi)), dent_by=0.05)


def wall(kit: Kit) -> None:
    """One 8 m wall section: a plate core with four riveted panels, two pipe runs and a capping pipe on each face."""
    h = WALL_LENGTH / 2
    solid(kit, "wall_core", -h, h, -WALL_CORE, WALL_CORE, -SKIRT, WALL_HEIGHT - 0.3, "plate")
    solid(kit, "wall_footing", -h, h, -1.25, 1.25, -SKIRT, 1.1, "concrete_b")
    for sign in (-1, 1):
        face = sign * (WALL_CORE + 0.04)
        for k in range(4):
            x = -h + (k + 0.5) * WALL_LENGTH / 4
            kit.box(f"wall_panel{sign}_{k}", (WALL_LENGTH / 4 - 0.12, 0.08, 7.6), (x, face, 5.6), kit.rng.choice(("plate_b", "plate_c", "plate", "plate_b")), rot=(0, kit.rng.uniform(-0.01, 0.01), 0), dent_by=0.02)
        rivets(kit, f"wall_rivet{sign}_", -h + 0.1, h - 0.1, sign * (WALL_CORE + 0.1), 2.0, 9.4, 0.04)
        for r, z in enumerate((3.4, 6.6)):
            pipe_x(kit, f"wall_pipe{sign}_{r}", -h + 0.05, h - 0.05, sign * 1.2, z, 0.25)
            for f in range(3):
                x = -h + 0.6 + f * (WALL_LENGTH - 1.2) / 2
                pipe_x(kit, f"wall_flange{sign}_{r}_{f}", x - 0.08, x + 0.08, sign * 1.1, z, 0.35, "pipe_light")
                kit.box(f"wall_bracket{sign}_{r}_{f}", (0.3, 0.5, z + 0.2), (x + 0.5, sign * 1.12, (z + 0.2) / 2 - 0.1), "pipe")
        pipe_x(kit, f"wall_cap{sign}", -h + 0.05, h - 0.05, sign * 0.75, WALL_HEIGHT - 0.15, 0.3, "pipe_light")
        apron(kit, f"wall_rubble{sign}_", sign, 7, 1.45, 3.5)
    kit.box("wall_top", (WALL_LENGTH, WALL_CORE * 2, 0.3), (0, 0, WALL_HEIGHT - 0.15), "concrete_b")


def tower(kit: Kit) -> None:
    """A 6 m footprint square pressure housing with a manifold, a valve wheel, a flat roof and two vent stacks."""
    solid(kit, "tower_plinth", -2.8, 2.8, -2.8, 2.8, -SKIRT, 2.6, "concrete_b")
    solid(kit, "tower_plinth_cap", -2.65, 2.65, -2.65, 2.65, 2.6, 3.1, "concrete")
    solid(kit, "tower_housing", -2.4, 2.4, -2.4, 2.4, 3.1, 13.0, "plate")
    for z in (4.6, 7.4, 10.2):
        solid(kit, f"tower_band{z}", -2.5, 2.5, -2.5, 2.5, z, z + 0.35, "plate_b")
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        for k in range(5):
            u = -1.8 + k * 0.9
            x, y = (sx * 2.46, u) if sx else (u, sy * 2.46)
            yaw = 0.0 if sx else math.pi / 2
            kit.box(f"tower_panel{sx}{sy}_{k}", (0.1, 0.8, 8.2), (x, y, 8.0), kit.rng.choice(("plate_b", "plate_c", "rust", "plate_b")), rot=(0, 0, yaw), dent_by=0.02)
    for k, z in enumerate((3.8, 5.6, 7.4)):
        pipe_y(kit, f"tower_spool{k}", -1.9, 1.9, 2.6, z, 0.25)
        for f, y in enumerate((-1.9, 0.0, 1.9)):
            pipe_x(kit, f"tower_stub{k}_{f}", 2.45, 2.8, y, z, 0.2, "pipe_light")
    pipe_x(kit, "tower_riser", 2.45, 2.8, 0.0, 9.6, 0.2, "pipe_light")
    kit.cylinder("tower_wheel_hub", 0.18, 0.5, (2.7, 0.0, 9.0), "valve", rot=(0, math.pi / 2, 0), vertices=6)
    kit.cylinder("tower_wheel", 0.78, 0.16, (2.7, 0.0, 9.0), "valve", rot=(0, math.pi / 2, 0), vertices=10)
    for k in range(4):
        a = k * math.pi / 4
        kit.box(f"tower_wheel_spoke{k}", (0.12, 1.5, 0.12), (2.7, 0.0, 9.0), "valve", rot=(a, 0, 0))
    solid(kit, "tower_roof", -2.55, 2.55, -2.55, 2.55, 13.0, 13.4, "concrete")
    for k, (x, y, r, top) in enumerate(((-1.0, -1.0, 0.5, TOWER_HEIGHT), (1.1, 1.0, 0.38, 15.0))):
        kit.cylinder(f"tower_stack{k}", r, top - 13.4, (x, y, (13.4 + top) / 2), "pipe", vertices=8)
        cap = kit.cylinder(f"tower_stack_cap{k}", r + 0.18, 0.4, (x, y, top - 0.2), "pipe_light", vertices=8)
        taper(cap, 1.0, 0.6)
    strut(kit, "tower_ladder_l", (-2.1, -2.5, 0.0), (-2.1, -2.5, 12.8), 0.1, "pipe")
    strut(kit, "tower_ladder_r", (-1.5, -2.5, 0.0), (-1.5, -2.5, 12.8), 0.1, "pipe")
    for k in range(12):
        kit.box(f"tower_rung{k}", (0.6, 0.08, 0.08), (-1.8, -2.5, 0.8 + k), "pipe")


def _leg(kit: Kit, name: str, y0: float, y1: float) -> None:
    """A riveted gantry leg: a concrete foot, a plate column with cross braces, and a top deck at 15 m."""
    solid(kit, f"{name}_foot", -9.8, -0.4, y0, y1, -SKIRT, 3.0, "concrete_b")
    solid(kit, f"{name}_column", -9.5, -0.6, y0 + 0.3, y1 - 0.3, 3.0, 14.4, "plate")
    solid(kit, f"{name}_deck", -9.8, -0.4, y0, y1, 14.4, 15.0, "concrete")
    mid = (y0 + y1) / 2
    for k, z in enumerate((5.2, 8.2, 11.2)):
        solid(kit, f"{name}_band{k}", -9.6, -0.5, y0 + 0.2, y1 - 0.2, z, z + 0.35, "plate_b")
    face_y = y0 + 0.26 if mid > 0 else y1 - 0.26
    for k in range(3):
        a = -1.5 - k * 2.6
        for flip in (-1, 1):
            strut(kit, f"{name}_brace{k}_{flip}", (a, face_y, 3.6 + k * 3.0), (a - 2.0, face_y, 6.2 + k * 3.0 + (0.0 if flip < 0 else -2.6)), 0.22, "pipe")
    inner_face = y0 + 0.2 if mid < 0 else y1 - 0.2
    pipe_x(kit, f"{name}_riser", -9.2, -1.0, inner_face, 15.7, 0.3, "pipe_light")


def gate(kit: Kit) -> None:
    """Two gantry legs flank a plate block under a three-pipe bridge, with sliding plate doors on a rail."""
    hw = GATE_WIDTH / 2
    _leg(kit, "gate_leg_n", hw - 5.5, hw)
    _leg(kit, "gate_leg_s", -hw, -(hw - 5.5))
    inner = hw - 5.5
    solid(kit, "gate_block", -9.6, -1.2, -inner, inner, -SKIRT, 9.6, "plate")
    solid(kit, "gate_block_cap", -9.7, -1.1, -inner, inner, 9.6, 10.0, "concrete")
    for k, z in enumerate((11.4, 12.8, 14.2)):
        pipe_y(kit, f"gate_bridge{k}", -hw + 0.4, hw - 0.4, -2.2 - 2.4 * k, z, 0.55 - 0.05 * k)
        for f, y in enumerate((-inner, inner)):
            pipe_y(kit, f"gate_bridge_flange{k}_{f}", y - 0.1, y + 0.1, -2.2 - 2.4 * k, z, 0.78, "pipe_light")
    for k, y in enumerate((-6.0, -2.0, 2.0, 6.0)):
        strut(kit, f"gate_post{k}", (-3.6, y, 10.0), (-3.6, y, 11.0), 0.3, "pipe")
    kit.box("gate_rail", (0.5, inner * 2 - 0.2, 0.4), (-0.65, 0.0, 9.0), "pipe")
    for k, sign in enumerate((-1, 1)):
        y = sign * (inner / 2 + 0.05)
        kit.box(f"gate_door{k}", (0.4, inner - 0.15, 8.4), (-0.65, y, 4.2), "plate_c", dent_by=0.02)
        for r in range(5):
            kit.box(f"gate_door{k}_rib{r}", (0.12, 0.2, 7.6), (-0.4, y + (r - 2) * (inner - 0.8) / 4, 4.2), "plate_b")
        for r, z in enumerate((2.0, 4.4, 6.8)):
            kit.box(f"gate_door{k}_strap{r}", (0.12, inner - 0.5, 0.3), (-0.4, y, z), "pipe")
        kit.cylinder(f"gate_door{k}_roller", 0.3, 0.3, (-0.65, y - sign * 1.4, 8.8), "pipe_light", rot=(math.pi / 2, 0, 0), vertices=8)
    kit.box("gate_seam", (0.44, 0.14, 8.4), (-0.65, 0.0, 4.2), "slit")


def inner(kit: Kit) -> None:
    """The inner gate: two riveted posts hold a rack of stacked pipes, with a beam across the top."""
    hd, hw = INNER_DEPTH / 2, INNER_WIDTH / 2
    for sign in (-1, 1):
        y = sign * (hw - 1.0)
        solid(kit, f"inner_post{sign}", -hd - 0.2, hd + 0.2, y - 1.0, y + 1.0, -SKIRT, INNER_HEIGHT, "plate")
        solid(kit, f"inner_post_foot{sign}", -hd - 0.2, hd + 0.2, y - 1.0, y + 1.0, -SKIRT, 1.4, "concrete_b")
        for z in (4.0, 7.0, 10.0):
            solid(kit, f"inner_post_band{sign}_{z}", -hd - 0.2, hd + 0.2, y - 1.0, y + 1.0, z, z + 0.3, "plate_b")
    inner_half = hw - 2.0
    for row in range(8):
        for col, x in enumerate((-0.9, 0.9)):
            pipe_y(kit, f"inner_rack{row}_{col}", -inner_half, inner_half, x, 0.5 + row * 0.95, 0.5, "pipe" if (row + col) % 2 else "pipe_light")
    for k, y in enumerate((-inner_half + 0.4, inner_half - 0.4)):
        solid(kit, f"inner_rack_post{k}", -1.5, 1.5, y - 0.2, y + 0.2, 0.0, 8.2, "plate_b")
    solid(kit, "inner_beam", -1.2, 1.2, -inner_half, inner_half, 8.4, 8.9, "plate_c")
    pipe_y(kit, "inner_top_pipe", -hw + 1.0, hw - 1.0, 0.0, INNER_HEIGHT - 0.8, 0.4, "pipe_light")


PIECES: dict[str, tuple[Callable[[Kit], None], float]] = {
    "wall": (wall, 34),
    "tower": (tower, 36),
    "gate": (gate, 46),
    "inner": (inner, 38),
}


def run(piece: str) -> None:
    """Builds fort_pumpworks_<piece> and exports it with an optional preview, from the script's command line."""
    if piece not in PIECES:
        raise KeyError(f"unknown fort piece {piece!r}. Known: {sorted(PIECES)}")
    args = parse_args()
    kit = Kit(COLORS, SEEDS[piece])
    build, view = PIECES[piece]
    build(kit)
    kit.export(f"fort_pumpworks_{piece}", args, view_size=view)
