"""Shared layout and helpers for the armor part scripts `arm_*.py`.

Armor is authored as a front-edge row of N deck cells. The row is N x 0.484 m across in Blender Y, centered, and
0.65 m deep in Blender X, centered on the origin. The outer face points to +X. The origin sits on the deck top.
The game turns the row to the edge its cells lie on and stretches it along its length up to 1.625 times, so rows
stay boxy and their ends stay flat, so neighbours tile cleanly.
"""

from __future__ import annotations

import math
from collections.abc import Callable

import bpy

from kit import CELL_ACROSS, CELL_ALONG, Kit, parse_args

OUTER_X = CELL_ALONG / 2  # The outer edge of the row.
PREVIEW_M = 2.6  # Default preview width, wide enough for a 4-cell row.
FIT_TOLERANCE = 0.01  # Seeded dents may push a vertex this far past the footprint.
# How far behind the outer edge a model may reach. The deepest wanted piece is the spaced armor's foot, 0.400 m
# behind the edge in arm_spaced.py (the ram and plow ram feet reach 0.330 and 0.360 m). Rear braces and bracket
# stems reached 0.48 to 0.65 m and drew as thin stems in top-down icons and on front, back and spare plates (#131).
BACK_DEPTH = 0.4

# Colors from src/render/palette.ts. The view swaps `paint` for the faction color.
COLORS = {
    "paint": 0x9C7A3E,  # FACTION_COLORS.player.top
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "dark": 0x2A2420,  # PAL.wheel
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "ceramic": 0xF0E0B8,  # PAL.plan
    "ceramic_dim": 0xB89A74,  # PAL.wall.top
    "sign": 0xF0D060,  # PAL.select
    "sign_red": 0xE05030,  # PAL.dest
    "sign_green": 0x5E6A5A,  # PAL.roof[1]
}


def half_span(n: int) -> float:
    """Half the row length in Blender Y for n cells."""
    return n * CELL_ACROSS / 2


def tilted_panel(kit: Kit, name: str, bottom: tuple[float, float], height: float, width: float, thick: float, tilt: float, mat: str, y: float = 0.0, dent_by: float = 0.0) -> None:
    """A flat panel across Y whose bottom edge sits at (x, z) and whose top leans back toward -X by tilt radians."""
    bx, bz = bottom
    center = (bx - math.sin(tilt) * height / 2, y, bz + math.cos(tilt) * height / 2)
    kit.box(name, (thick, width, height), center, mat, rot=(0, -tilt, 0), dent_by=dent_by)


def rivets(kit: Kit, name: str, x: float, ys: list[float], z: float, mat: str = "metal_light") -> None:
    """A row of rivet heads on an outer face at x, one per y."""
    for i, y in enumerate(ys):
        kit.box(f"{name}{i}", (0.03, 0.035, 0.035), (x, y, z), mat)


def spread(n: int, half: float) -> list[float]:
    """n evenly spaced values from -half to +half."""
    if n == 1:
        return [0.0]
    return [-half + 2 * half * i / (n - 1) for i in range(n)]


def check_fit(name: str, n: int, reach: float, back: float = BACK_DEPTH) -> None:
    """Raises if any vertex leaves the row's footprint, the deck top, the reach past the outer edge, or lies more than back behind it."""
    pts = [o.matrix_world @ v.co for o in bpy.context.scene.objects if o.type == "MESH" for v in o.data.vertices]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    half = half_span(n)
    t = FIT_TOLERANCE
    if lo[0] < OUTER_X - back - t or hi[0] > reach + t or lo[1] < -half - t or hi[1] > half + t or lo[2] < -t:
        raise RuntimeError(f"{name} leaves its {n}-cell row: X {lo[0]:.3f}..{hi[0]:.3f} (min {OUTER_X - back:.3f}, max {reach}), Y {lo[1]:.3f}..{hi[1]:.3f} (half {half}), Z from {lo[2]:.3f}")


def run(name: str, build: Callable[[Kit], None], seed: int, n: int, reach: float = OUTER_X, preview_m: float = PREVIEW_M) -> None:
    """Builds one n-cell armor row, checks its fit, and exports it with its preview.

    reach is the largest X the model may use. Rams pass a value past the outer edge. Tall models pass a wider preview_m.
    """
    args = parse_args()
    kit = Kit(COLORS, seed)
    build(kit)
    check_fit(name, n, reach, BACK_DEPTH)
    kit.export(name, args, view_size=preview_m)
