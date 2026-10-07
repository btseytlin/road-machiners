"""Salvage Yard's fortress pieces in the yard style (C4): dark rusted plate walls on a rubble apron, pale concrete
towers on battered buttressed bases, and a rust plate gate.

Each fort_yard_<piece>.py script calls run(piece). Geometry helpers come from fort_kit.py.

Sizes, with one tile = 4 m:
- wall: one straight section 8.0 m along X, centered on the origin, 12 m tall, the same on both long faces. Five
  1.6 m plates per face, over a rubble apron at the foot that stays inside the 2.9 m depth. The game stretches it
  along X only.
- tower: a 6 m footprint centered on the origin, 16 m tall to its equipment box, with an antenna above. A battered
  base with corner buttresses fills the footprint, and the 5.1 m concrete shaft above has slit windows, a rail and lamps
  that use the glow material.
- gate: 10 m wide along Y, 4 m deep along X and 12 m tall. Its outer face is the plane X = 0 and it faces +X, so the
  origin is the center of the outer face at ground level and the body runs to X = -4. Rust plate leaves stand between
  concrete posts. No lamps: the gate furniture owns them. Nothing reaches past X = 0 (no flare).

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

WALL_LENGTH = 8.0
WALL_HALF_DEPTH = 1.0  # the plate core; the rubble apron runs out to 1.45 m
WALL_HEIGHT = 12.0
PLATES = 5
TOWER_HALF = 2.55  # the shaft; C4's towers are about half as wide as tall
BASE_TOP = 5.0  # where the battered base meets the shaft
SHAFT_TOP = 14.4
TOWER_HEIGHT = 16.0
GATE_WIDTH = 10.0
GATE_DEPTH = 4.0
GATE_HEIGHT = 12.0
LEAF_TOP = 9.4

# Colors from src/render/palette.ts. C4 has dark rusted plates, pale concrete and dark broken rock.
COLORS = {
    "plate": 0x3A2418,  # PAL.rust.dark
    "plate_b": 0x3A2E26,  # FACTION_COLORS.vultures.top
    "plate_c": 0x2A2420,  # PAL.wheel
    "rust": 0x5E3420,  # PAL.rust.side
    "rust_top": 0x8A4A2A,  # PAL.rust.top
    "concrete": 0xB8B8B0,  # FACTION_COLORS.convoys.top
    "concrete_b": 0x9A8A78,  # PAL.rock.top, weathered panels and the buttresses
    "slit": 0x1A1410,  # PAL.outline
    "rubble": 0x4E453C,  # PAL.rock.dark
    "rubble_b": 0x6E6254,  # PAL.rock.side
    "metal": 0x5A5A58,  # PAL.metal
    "glow": 0xFFF2C8,  # PAL.lamp.on
}

SEEDS = {"wall": 701, "tower": 702, "gate": 703}


def solid(kit: Kit, name: str, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float, mat: str) -> None:
    """An axis-aligned box from its bounds."""
    extrude(kit, name, rect(x0, x1, y0, y1), rect(x0, x1, y0, y1), z0, z1, mat)


def _apron(kit: Kit, name: str, sign: int, count: int) -> None:
    """Broken rock and concrete chunks along one foot of the wall, between the core and 1.45 m out."""
    for i in range(count):
        s = kit.rng.uniform(0.35, 0.6)
        x = kit.rng.uniform(-3.5, 3.5)
        y = sign * kit.rng.uniform(WALL_HALF_DEPTH + 0.05, 1.45 - s * 0.75)
        kit.box(f"{name}{i}", (s, s * 0.8, s * 0.7), (x, y, kit.rng.uniform(0.0, 0.5)), kit.rng.choice(("rubble", "rubble_b", "rubble")),
                rot=(kit.rng.uniform(-0.4, 0.4), kit.rng.uniform(-0.4, 0.4), kit.rng.uniform(0, math.pi)), dent_by=0.05)


def wall(kit: Kit) -> None:
    """One 8 m wall section: dark rusted vertical plates with seams and stiffeners on both faces, and a rubble apron."""
    h, d = WALL_LENGTH / 2, WALL_HALF_DEPTH
    solid(kit, "wall_core", -h, h, -d, d, -SKIRT, WALL_HEIGHT - 0.3, "plate")
    width = WALL_LENGTH / PLATES
    for sign in (-1, 1):
        y0, y1 = sorted((sign * d, sign * (d + 0.07)))
        for i in range(PLATES):
            x = -h + (i + 0.5) * width
            mat = kit.rng.choice(("plate", "plate_b", "plate_c", "plate_b"))
            top = WALL_HEIGHT - kit.rng.uniform(0.3, 0.8)
            kit.box(f"wall_plate{sign}_{i}", (width - 0.08, 0.07, top), (x, sign * (d + 0.035), top / 2), mat, dent_by=0.02)
            # Rust bleeding from the plate's top and its rivet line.
            for k in range(2):
                rx = x + kit.rng.uniform(-width / 3, width / 3)
                z1 = top - kit.rng.uniform(0.2, 4.0)
                solid(kit, f"wall_rust{sign}_{i}_{k}", rx - 0.15, rx + 0.15, *sorted((sign * (d + 0.07), sign * (d + 0.09))), z1 - kit.rng.uniform(1.0, 3.0), z1, "rust")
        for k, z in enumerate((3.8, 7.8)):
            solid(kit, f"wall_stiffener{sign}_{k}", -h, h, *sorted((y1 if sign > 0 else y0, sign * (d + 0.14))), z - 0.1, z + 0.1, "metal")
        _apron(kit, f"wall_apron{sign}_", sign, 9)
    solid(kit, "wall_lip", -h, h, -d - 0.12, d + 0.12, WALL_HEIGHT - 0.3, WALL_HEIGHT, "plate_c")


def tower(kit: Kit) -> None:
    """A battered, buttressed concrete base, a concrete shaft with slits and lamps, a railed roof and an antenna."""
    s = TOWER_HALF
    base = 2.95
    extrude(kit, "tower_base", rect(-base, base, -base, base), rect(-s - 0.1, s + 0.1, -s - 0.1, s + 0.1), -SKIRT, BASE_TOP, "concrete_b")
    # Sloped buttresses on the corners, as C4's towers stand on.
    for px in (-1, 1):
        for py in (-1, 1):
            foot = rect(*sorted((px * (base - 1.6), px * 2.95)), *sorted((py * (base - 1.6), py * 2.95)))
            head = rect(*sorted((px * (s - 0.5), px * (s + 0.12))), *sorted((py * (s - 0.5), py * (s + 0.12))))
            extrude(kit, f"tower_buttress{px}{py}", foot, head, -SKIRT, BASE_TOP + 2.2, "concrete")
    solid(kit, "tower_shaft", -s, s, -s, s, BASE_TOP - 0.2, SHAFT_TOP, "concrete")
    # Panels: a 1.5 m grid of seams and a few weathered panels, slit windows at two heights, lamps near the top.
    for face, (ax, sign) in enumerate((("x", 1), ("y", 1), ("x", -1), ("y", -1))):
        n = sign * (s + 0.02)

        def put(name: str, u0: float, u1: float, z0: float, z1: float, mat: str, out: float = 0.03) -> None:
            a, b = sorted((n - sign * 0.03, n + sign * out))
            if ax == "x":
                solid(kit, name, a, b, u0, u1, z0, z1, mat)
            else:
                solid(kit, name, u0, u1, a, b, z0, z1, mat)

        for k, z in enumerate((6.6, 8.2, 9.8, 11.4, 13.0)):
            put(f"tower_seam{face}_{k}", -s, s, z - 0.04, z + 0.04, "concrete_b")
        for k in range(3):
            u = kit.rng.uniform(-s + 0.7, s - 0.7)
            z = kit.rng.choice((7.4, 9.0, 10.6, 12.2))
            put(f"tower_panel{face}_{k}", u - 0.65, u + 0.65, z - 0.7, z + 0.7, "concrete_b")
        put(f"tower_slit{face}_a", -0.9, 0.9, 10.2, 10.6, "slit", 0.05)
        put(f"tower_slit{face}_b", -0.15, 0.15, 7.0, 8.2, "slit", 0.05)
        put(f"tower_lamp{face}", 0.9, 1.3, 13.3, 13.8, "glow", 0.25)
    # The roof: a lip, a rail round it, an equipment box to 16 m and an antenna.
    solid(kit, "tower_lip", -s - 0.15, s + 0.15, -s - 0.15, s + 0.15, SHAFT_TOP - 0.3, SHAFT_TOP, "concrete_b")
    for px in (-1, 0, 1):
        for py in (-1, 0, 1):
            if px or py:
                x, y = px * (s + 0.05), py * (s + 0.05)
                solid(kit, f"tower_rail_post{px}{py}", x - 0.05, x + 0.05, y - 0.05, y + 0.05, SHAFT_TOP, SHAFT_TOP + 1.1, "metal")
    for k, (x0, x1, y0, y1) in enumerate(((-s, s, s, s + 0.1), (-s, s, -s - 0.1, -s), (s, s + 0.1, -s, s), (-s - 0.1, -s, -s, s))):
        solid(kit, f"tower_rail{k}", x0, x1, y0, y1, SHAFT_TOP + 1.0, SHAFT_TOP + 1.1, "metal")
    solid(kit, "tower_box", -1.4, 0.2, -1.4, 0.0, SHAFT_TOP, TOWER_HEIGHT, "metal")
    solid(kit, "tower_box_b", 0.4, 1.4, -1.2, -0.4, SHAFT_TOP, SHAFT_TOP + 0.9, "plate_c")
    strut(kit, "tower_antenna", (1.0, 1.0, SHAFT_TOP), (1.0, 1.0, TOWER_HEIGHT + 2.6), 0.12, "metal", sides=5)
    strut(kit, "tower_antenna_b", (-0.6, -0.7, TOWER_HEIGHT), (-0.6, -0.7, TOWER_HEIGHT + 1.4), 0.08, "metal", sides=5)


def gate(kit: Kit) -> None:
    """Rust plate leaves between concrete posts under a dark plate head, with the wall's lip on top."""
    hw = GATE_WIDTH / 2
    inner = hw - 1.1
    back = -GATE_DEPTH + 0.05
    for sign in (-1, 1):
        y0, y1 = sorted((sign * inner, sign * (hw - 0.05)))
        solid(kit, f"gate_post{sign}", back, -0.05, y0, y1, -SKIRT, GATE_HEIGHT, "concrete")
        solid(kit, f"gate_post{sign}_seam", -0.06, -0.02, y0, y1, 6.0, 6.08, "concrete_b")
    solid(kit, "gate_head", back + 0.8, -0.5, -inner, inner, LEAF_TOP, GATE_HEIGHT - 0.3, "plate")
    solid(kit, "gate_head_beam", -0.5, -0.05, -inner, inner, LEAF_TOP, LEAF_TOP + 0.6, "metal")
    for i in range(4):
        y = -inner + (i + 0.5) * inner / 2
        solid(kit, f"gate_head_plate{i}", -0.5, -0.43, y - inner / 4 + 0.04, y + inner / 4 - 0.04, LEAF_TOP + 0.6, GATE_HEIGHT - 0.3, ("plate_b", "plate_c")[i % 2])
    solid(kit, "gate_lip", back, -0.05, -hw + 0.05, hw - 0.05, GATE_HEIGHT - 0.3, GATE_HEIGHT, "plate_c")
    # Two leaves of vertical rust plates with stiffeners and a seam, 0.8 m behind the post faces.
    front = -0.8
    solid(kit, "gate_leaves", front - 0.5, front, -inner, inner, 0.0, LEAF_TOP, "plate")
    for side, (a, b) in (("l", (-inner, -0.05)), ("r", (0.05, inner))):
        n = 4
        for i in range(n):
            y0 = a + (b - a) * i / n
            y1 = a + (b - a) * (i + 1) / n
            kit.box(f"gate_{side}_plate{i}", (0.08, y1 - y0 - 0.06, LEAF_TOP - 0.2), (front + 0.04, (y0 + y1) / 2, (LEAF_TOP - 0.2) / 2), kit.rng.choice(("rust", "rust", "plate")), dent_by=0.02)
        for k, z in enumerate((1.2, LEAF_TOP / 2, LEAF_TOP - 1.2)):
            solid(kit, f"gate_{side}_bar{k}", front + 0.08, front + 0.18, a + 0.1, b - 0.1, z - 0.12, z + 0.12, "metal")
    solid(kit, "gate_seam", front, front + 0.2, -0.05, 0.05, 0.0, LEAF_TOP, "plate")


PIECES: dict[str, tuple[Callable[[Kit], None], float]] = {
    "wall": (wall, 14),
    "tower": (tower, 32),
    "gate": (gate, 24),
}


def run(piece: str) -> None:
    """Builds fort_yard_<piece> and exports it with an optional preview, from the script's command line."""
    if piece not in PIECES:
        raise KeyError(f"unknown yard piece {piece!r}. Known: {sorted(PIECES)}")
    args = parse_args()
    kit = Kit(COLORS, SEEDS[piece])
    build, view = PIECES[piece]
    build(kit)
    kit.export(f"fort_yard_{piece}", args, view_size=view)
