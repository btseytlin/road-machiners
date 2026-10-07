"""Granary's fortress pieces in the ring style (C3): a smooth pale wall with ribs, rust streaks and a round hatch,
and a recessed dark gate portal. The ring has no towers.

Each fort_ring_<piece>.py script calls run(piece). Geometry helpers come from fort_kit.py.

Sizes, with one tile = 4 m:
- wall: one straight section 8.0 m along X, centered on the origin, 12 m tall and 2.8 m deep, with a chamfered top.
  A vertical rib stands at each module end, so walls laid end to end show one rib per joint. The game stretches it
  along X only. +Y faces out of the site, since the layout lays walls counterclockwise: the round hatch is on the
  +Y face.
- gate: 8 m wide along Y, 4 m deep along X and 12 m tall. Its outer face is the plane X = 0 and it faces +X, so the
  origin is the center of the outer face at ground level and the body runs to X = -4. Dark shut doors stand 1.6 m
  back in a pale frame. Nothing reaches past X = 0 (no flare).

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

WALL_LENGTH = 8.0
WALL_HALF_DEPTH = 1.35
WALL_HEIGHT = 12.0
SHOULDER = 10.6  # where the chamfered top starts
TOP_HALF = 0.6  # half the flat top's depth
SEAMS = (4.0, 7.6)
GATE_WIDTH = 8.0
GATE_DEPTH = 4.0
GATE_HEIGHT = 12.0
RECESS = 1.6
DOOR_TOP = 7.2

# Colors from src/render/palette.ts. C3 is pale weathered panels with grey ribs and rust streaks.
COLORS = {
    "pale": 0xB8B8B0,  # FACTION_COLORS.convoys.top
    "shade": 0x86867E,  # FACTION_COLORS.convoys.side, panel seams and ribs
    "rib": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "dark": 0x2A2420,  # PAL.wheel, the portal's shadow
    "door": 0x3E4248,  # FACTION_COLORS.mercs.cabSide
    "metal": 0x5A5A58,  # PAL.metal
}

SEEDS = {"wall": 601, "gate": 602}


def solid(kit: Kit, name: str, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float, mat: str) -> None:
    """An axis-aligned box from its bounds."""
    extrude(kit, name, rect(x0, x1, y0, y1), rect(x0, x1, y0, y1), z0, z1, mat)


def _streaks(kit: Kit, name: str, sign: int, d: float, count: int) -> None:
    """Rust over a long face, as C3's blotches: short runs down from the shoulder and the seams, and small patches
    and dashes scattered over the panels."""
    y0, y1 = sorted((sign * d, sign * (d + 0.05)))
    for i in range(count):
        x = kit.rng.uniform(-3.5, 3.5)
        mat = kit.rng.choice(("rust", "rust", "rust_side"))
        roll = kit.rng.random()
        if roll < 0.35:
            z1 = kit.rng.choice((SHOULDER - 0.1, SEAMS[1] - 0.07, SEAMS[0] - 0.07))
            w, z0 = kit.rng.uniform(0.1, 0.35), z1 - kit.rng.uniform(0.6, 2.4)
        elif roll < 0.7:
            w, z0 = kit.rng.uniform(0.4, 1.1), kit.rng.uniform(0.6, SHOULDER - 0.6)
            z1 = z0 + kit.rng.uniform(0.1, 0.25)
        else:
            w, z0 = kit.rng.uniform(0.2, 0.6), kit.rng.uniform(0.6, SHOULDER - 1.2)
            z1 = z0 + kit.rng.uniform(0.2, 0.7)
        solid(kit, f"{name}{i}", x - w / 2, x + w / 2, y0, y1, max(z0, 0.6), z1, mat)


def wall(kit: Kit) -> None:
    """One 8 m wall section: pale panels with seams, a chamfered top, end ribs, rust streaks and a round hatch."""
    h, d = WALL_LENGTH / 2, WALL_HALF_DEPTH
    solid(kit, "wall_core", -h, h, -d, d, -SKIRT, SHOULDER, "pale")
    extrude(kit, "wall_top", rect(-h, h, -d, d), rect(-h, h, -TOP_HALF, TOP_HALF), SHOULDER, WALL_HEIGHT, "pale")
    for sign in (-1, 1):
        for k, z in enumerate(SEAMS):
            solid(kit, f"wall_seam{sign}_{k}", -h, h, *sorted((sign * d, sign * (d + 0.04))), z - 0.06, z + 0.06, "shade")
        solid(kit, f"wall_foot{sign}", -h, h, *sorted((sign * d, sign * (d + 0.1))), -SKIRT, 0.5, "shade")
        _streaks(kit, f"wall_streak{sign}_", sign, d, 26)
    # Ribs at both module ends: half a rib each, so two walls end to end make one, following the chamfer.
    for k, x0, x1 in ((0, -h, -h + 0.22), (1, h - 0.22, h)):
        solid(kit, f"wall_rib{k}", x0, x1, -d - 0.12, d + 0.12, -SKIRT, SHOULDER, "rib")
        extrude(kit, f"wall_rib{k}_top", rect(x0, x1, -d - 0.12, d + 0.12), rect(x0, x1, -TOP_HALF - 0.12, TOP_HALF + 0.12), SHOULDER, WALL_HEIGHT, "rib")
    # The round hatch low on the outer face (C3), with a dark rim and a handwheel.
    hy = d + 0.02
    kit.cylinder("wall_hatch_rim", 0.95, 0.12, (1.6, hy, 1.7), "metal", rot=(math.pi / 2, 0, 0), vertices=12)
    kit.cylinder("wall_hatch", 0.75, 0.16, (1.6, hy + 0.01, 1.7), "door", rot=(math.pi / 2, 0, 0), vertices=12)
    kit.cylinder("wall_hatch_wheel", 0.3, 0.06, (1.6, hy + 0.09, 1.7), "rib", rot=(math.pi / 2, 0, 0), vertices=8)


def gate(kit: Kit) -> None:
    """A pale frame block with a dark portal recessed 1.6 m, shut dark doors at its back and a steel head frame."""
    hw = GATE_WIDTH / 2
    inner = hw - 1.3
    back = -GATE_DEPTH + 0.05
    for sign in (-1, 1):
        y0, y1 = sorted((sign * inner, sign * (hw - 0.05)))
        solid(kit, f"gate_jamb{sign}", back, -0.05, y0, y1, -SKIRT, SHOULDER, "pale")
        extrude(kit, f"gate_jamb{sign}_top", rect(back, -0.05, y0, y1), rect(back + 0.6, -0.6, y0, y1), SHOULDER, GATE_HEIGHT, "pale")
        # The reveal: the jamb's face into the opening is in shadow.
        ry = sign * (inner + 0.02)
        solid(kit, f"gate_reveal{sign}", -RECESS, -0.05, *sorted((ry, sign * (inner - 0.04))), 0.0, DOOR_TOP, "dark")
        solid(kit, f"gate_rib{sign}", -0.25, -0.05, *sorted((sign * (inner - 0.05), sign * (inner + 0.4))), 0.0, DOOR_TOP + 0.6, "metal")
    solid(kit, "gate_lintel", back, -0.05, -inner, inner, DOOR_TOP, SHOULDER, "pale")
    extrude(kit, "gate_lintel_top", rect(back, -0.05, -inner, inner), rect(back + 0.6, -0.6, -inner, inner), SHOULDER, GATE_HEIGHT, "pale")
    solid(kit, "gate_soffit", -RECESS, -0.05, -inner, inner, DOOR_TOP - 0.05, DOOR_TOP, "dark")
    solid(kit, "gate_head", -0.3, -0.05, -inner - 0.4, inner + 0.4, DOOR_TOP, DOOR_TOP + 0.5, "metal")
    # Dark doors at the back of the recess.
    solid(kit, "gate_doors", back, -RECESS, -inner, inner, 0.0, DOOR_TOP, "dark")
    for side, (a, b) in (("l", (-inner + 0.1, -0.08)), ("r", (0.08, inner - 0.1))):
        solid(kit, f"gate_leaf_{side}", -RECESS, -RECESS + 0.08, a, b, 0.0, DOOR_TOP - 0.3, "door")
        for k, z in enumerate((1.4, 3.6, 5.8)):
            solid(kit, f"gate_leaf_{side}_bar{k}", -RECESS + 0.08, -RECESS + 0.14, a + 0.1, b - 0.1, z - 0.1, z + 0.1, "metal")
    for k in range(5):
        y = kit.rng.uniform(-hw + 0.3, hw - 0.3)
        if abs(y) < inner:
            continue
        solid(kit, f"gate_streak{k}", -0.05, -0.01, y - 0.15, y + 0.15, SHOULDER - kit.rng.uniform(2.0, 4.0), SHOULDER - 0.1, "rust")


PIECES: dict[str, tuple[Callable[[Kit], None], float]] = {
    "wall": (wall, 14),
    "gate": (gate, 22),
}


def run(piece: str) -> None:
    """Builds fort_ring_<piece> and exports it with an optional preview, from the script's command line."""
    if piece not in PIECES:
        raise KeyError(f"unknown ring piece {piece!r}. Known: {sorted(PIECES)}")
    args = parse_args()
    kit = Kit(COLORS, SEEDS[piece])
    build, view = PIECES[piece]
    build(kit)
    kit.export(f"fort_ring_{piece}", args, view_size=view)
