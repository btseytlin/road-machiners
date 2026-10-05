"""The niva base: a stylized Lada Niva 4x4, the short two-box Soviet off-roader.

Grid: 4 columns by 7 rows, 1.94 m across by 4.55 m along. Half height 0.4 m, from PHYSICS.bodies.niva.
The ground is 1.10 m below the center, so the flat roof at 0.89 m stands 2.0 m tall and the hood at 0.09 m is 60 % of that.
A short flat hood, a quarter of the length, with a cutout over the engine cells. Behind it a tall upright cabin with a steeply raked windshield,
a long door window, a quarter window and a near-vertical tail under a flat roof that runs back from the windshield top.
The nose is a wide dark grille panel with round headlamps inset at each end, lamp blocks at the hood corners and a thick dark bumper.
Wheels sit on rows 1 and 5 in the outer columns, radius 0.45 m, half width 0.18 m, mount 0.25 m below the center. Arches are cut on them.
The sockets arch_front, arch_rear (the left arch center at the hub) and arch_front_top (its crown) let wheelArches.test.ts check them against physics.
The sill hangs 0.21 m below the collider bottom as skin only.
Run: blender --background --python tools/blender/base_niva.py -- public/models/base_niva.glb [tmp/base_niva.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import (  # noqa: E402
    ARCH_CLEARANCE,
    BASE_COLORS,
    INSET,
    SUSPENSION_REST,
    Grid,
    arch_cut,
    check_base,
    cut_boxes,
    flare,
    hull_layers,
    level_sockets,
)
from shapes import prism  # noqa: E402

SEED = 313
G = Grid(rows=7, cols=4, half_height=0.4)
WHEEL_X = 1.3  # PHYSICS.bodies.niva.wheelX
WHEEL_Y = -0.25  # PHYSICS.bodies.niva.wheelY
WHEEL_R = 0.45  # PHYSICS.bodies.niva.wheelRadius
WHEEL_HALF_W = 0.18  # PHYSICS.bodies.niva.wheelHalfWidth
HUB_Z = WHEEL_Y - SUSPENSION_REST
WHEELS_X = [WHEEL_X, -WHEEL_X]
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
SILL = -0.83  # skin only, below the collider bottom
HOOD = 0.09  # the flat hood top and the beltline
ROOF = 0.89  # the flat roof: every cabin row's surface
COWL = 1.13  # the windshield base
ROOF_FRONT = 0.68  # the windshield top, raked back from the cowl
BAY_FRONT = 1.82  # the engine cutout covers the cells under the hood, columns 1 and 2
BAY_BACK = 1.15
BAY_LEFT = G.col_y(0.5)
BAY_RIGHT = G.col_y(2.5)
BAY_FLOOR = -0.3  # a 0.5 m engine pokes 0.2 m out of the cutout


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def lower_body(kit: Kit) -> None:
    """The hood-high body with arches cut on the wheels and the engine cutout, flares and a skid."""
    low = hull_layers("lower", [(SILL, FRONT, BACK, SIDE, 0.12), (HOOD - 0.05, FRONT, BACK, SIDE, 0.12), (HOOD, FRONT - 0.04, BACK + 0.02, SIDE - 0.05, 0.12)])
    arch_cut(low, WHEELS_X, HUB_Z, WHEEL_R, WELL_Y, SILL)
    cut_boxes(low, [((BAY_BACK, BAY_RIGHT, BAY_FLOOR), (BAY_FRONT, BAY_LEFT, HOOD + 0.2))])
    low.data.materials.clear()  # the booleans leave an empty slot, which would take the faces off the paint
    kit._add(low, "lower", "paint", 0.0)
    for i, wx in enumerate(WHEELS_X):
        flare(kit, f"flare{i}_l", G, wx, HUB_Z, WHEEL_R, SIDE, G.half_y, SILL)
        flare(kit, f"flare{i}_r", G, wx, HUB_Z, WHEEL_R, -G.half_y, -SIDE, SILL)


def cabin(kit: Kit) -> None:
    """A tall upright cabin: a steeply raked windshield, one long door window, a quarter window and a near-vertical tail."""
    layers = [
        (HOOD - 0.02, COWL, BACK + 0.02, SIDE - 0.04, 0.05),
        (ROOF - 0.08, ROOF_FRONT + 0.03, BACK + 0.05, SIDE - 0.1, 0.08),
        (ROOF, ROOF_FRONT, BACK + 0.08, SIDE - 0.14, 0.12),
    ]
    kit._add(hull_layers("cabin", layers), "cabin", "paint", 0.0)
    rise = ROOF - HOOD
    run = COWL - ROOF_FRONT
    tilt = math.atan2(run, rise)
    length = math.hypot(run, rise) - 0.2
    kit.box(
        "windshield",
        (0.03, 2 * (SIDE - 0.2), length),
        ((COWL + ROOF_FRONT) / 2 + 0.012, 0, (HOOD + ROOF) / 2 + 0.007),
        "glass",
        rot=(0, -tilt, 0),
    )
    lo, hi = HOOD + 0.12, ROOF - 0.13
    side_y = SIDE - 0.1
    door = [(0.5, lo), (-0.45, lo), (-0.45, hi), (0.5 - 0.15, hi)]
    quarter = [(-0.62, lo + 0.05), (-1.55, lo + 0.05), (-1.55, hi), (-0.62, hi)]
    for name, prof in (("door_glass", door), ("quarter_glass", quarter)):
        prism(kit, f"{name}_l", prof, side_y + 0.015, side_y + 0.045, "glass")
        prism(kit, f"{name}_r", prof, -side_y - 0.045, -side_y - 0.015, "glass")
    for s, sy in (("l", 1), ("r", -1)):
        kit.box(f"mirror_{s}", (0.1, 0.08, 0.14), (COWL - 0.1, sy * (SIDE - 0.03), HOOD + 0.3), "under")
    mirrored(kit, "taillight", (INSET, 0.14, 0.3), BACK - INSET / 2 + 0.01, SIDE - 0.16, 0.0, "red")
    kit.box("rear_bumper", (0.08, 2 * SIDE, 0.2), (BACK + 0.03, 0, -0.55), "under")


def nose(kit: Kit) -> None:
    """A full-width dark grille with round headlamps inset at each end, lamp blocks at the hood corners and a thick bumper."""
    kit.box("grille", (0.06, 2 * (SIDE - 0.1), 0.36), (FRONT - 0.03, 0, -0.22), "under")
    for s, sy in (("l", 1), ("r", -1)):
        kit.cylinder(f"lamp_{s}", 0.13, 0.06, (FRONT - 0.03, sy * (SIDE - 0.26), -0.22), "light", rot=(0, math.pi / 2, 0), vertices=8)
        kit.box(f"corner_lamp_{s}", (0.06, 0.26, 0.1), (FRONT - 0.04, sy * (SIDE - 0.2), HOOD - 0.07), "light")
    kit.box("bumper", (0.12, 2 * SIDE, 0.22), (FRONT - 0.06, 0, -0.58), "under")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    lower_body(kit)
    cabin(kit)
    nose(kit)
    kit.socket("arch_front", (WHEEL_X, G.col_y(0), HUB_Z))
    kit.socket("arch_rear", (-WHEEL_X, G.col_y(0), HUB_Z))
    kit.socket("arch_front_top", (WHEEL_X, G.col_y(0), HUB_Z + WHEEL_R + ARCH_CLEARANCE))
    bay = {(x, y): BAY_FLOOR for x in (1, 2) for y in (0, 1)}
    level_sockets(kit, G, "row", [HOOD] * 2 + [ROOF] * 5, fronts={2: ROOF_FRONT}, cells=bay)
    level_sockets(kit, G, "floor", [G.top] * G.rows, cells=bay)
    check_base(kit, "base_niva", G)
    kit.export("base_niva", args, view_size=6.0)


if __name__ == "__main__":
    main()
