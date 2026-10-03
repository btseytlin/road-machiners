"""The niva base: a stylized Lada Niva 4x4, the short two-box Soviet off-roader.

Grid: 4 columns by 7 rows, 1.94 m across by 4.55 m along. Half height 0.4 m, from PHYSICS.bodies.niva.
Rows 0 and 1 are a short flat hood with a cutout over the engine cells, behind it a tall upright cabin with a raked windshield,
one long door window, a small quarter window and a near-vertical tail under a flat roof.
The nose is a wide dark grille panel with round headlamps inset at each end, small lamp blocks at the hood corners and a thick dark bumper.
Wheels sit on rows 1 and 5 in the outer columns, radius 0.45 m, half width 0.18 m, mount 0.25 m below the center.
Run: blender --background --python tools/blender/base_niva.py -- public/models/base_niva.glb [tmp/base_niva.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import BASE_COLORS, INSET, SUSPENSION_REST, Grid, arch_profile, check_base, cut_boxes, flare, hull_mesh, level_sockets  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 313
G = Grid(rows=7, cols=4, half_height=0.4)
WHEEL_R = 0.45
WHEEL_HALF_W = 0.18
HUB_Z = -0.25 - SUSPENSION_REST
WHEELS_X = [G.row_x(1), G.row_x(5)]
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
HOOD = 0.6  # the flat hood top and the beltline
ROOF = 1.35  # the flat roof: every cabin row's surface
COWL = 0.8  # the windshield base
SCREEN_TOP = 0.42  # the windshield top, raked back from the cowl
BAY_FRONT = 1.82  # the engine cutout covers the cells under the hood, columns 1 and 2
BAY_BACK = 0.91
BAY_LEFT = G.col_y(0.5)
BAY_RIGHT = G.col_y(2.5)
BAY_FLOOR = 0.12  # a 0.5 m engine pokes 0.38 m out of the cutout


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def lower_body(kit: Kit) -> None:
    """Side panels with wheel arches up to the hood line, the core with the engine cutout, flares and a skid."""
    profile = arch_profile(G, WHEELS_X, HUB_Z, WHEEL_R, HOOD)
    prism(kit, "skin_l", profile, WELL_Y, SIDE, "paint")
    prism(kit, "skin_r", profile, -SIDE, -WELL_Y, "paint")
    pts = [(x, y, z) for x in (FRONT, BACK) for y in (WELL_Y, -WELL_Y) for z in (G.bottom, HOOD)]
    core = hull_mesh("core", pts)
    cut_boxes(core, [((BAY_BACK, BAY_RIGHT, BAY_FLOOR), (BAY_FRONT, BAY_LEFT, HOOD + 0.2))])
    core.data.materials.clear()  # the boolean leaves an empty slot, which would take the faces off the paint
    kit._add(core, "core", "paint", 0.0)
    kit.box("bay_floor", (BAY_FRONT - BAY_BACK, BAY_LEFT - BAY_RIGHT, 0.02), ((BAY_FRONT + BAY_BACK) / 2, (BAY_LEFT + BAY_RIGHT) / 2, BAY_FLOOR + 0.01), "under")
    for i, wx in enumerate(WHEELS_X):
        flare(kit, f"flare{i}_l", G, wx, HUB_Z, WHEEL_R, SIDE, G.half_y)
        flare(kit, f"flare{i}_r", G, wx, HUB_Z, WHEEL_R, -G.half_y, -SIDE)


def cabin(kit: Kit) -> None:
    """A tall upright cabin: a raked windshield, one long door window, a small quarter window and a near-vertical tail."""
    top_front = COWL - SCREEN_TOP
    pts = []
    for y in (SIDE - 0.06, -SIDE + 0.06):
        pts += [(COWL, y, HOOD), (BACK, y, HOOD)]
    for y in (SIDE - 0.14, -SIDE + 0.14):
        pts += [(top_front, y, ROOF), (BACK + 0.06, y, ROOF)]
    kit._add(hull_mesh("cabin", pts), "cabin", "paint", 0.0)
    lo, hi = HOOD + 0.05, ROOF - 0.08
    rake = (COWL - top_front) / (ROOF - HOOD)
    shield = [(COWL - rake * (lo - HOOD), lo), (COWL - rake * (lo - HOOD) + 0.03, lo), (COWL - rake * (hi - HOOD) + 0.03, hi), (COWL - rake * (hi - HOOD), hi)]
    prism(kit, "windshield", shield, -SIDE + 0.2, SIDE - 0.2, "glass")
    wlo, whi = HOOD + 0.12, ROOF - 0.13
    side_y = SIDE - 0.04
    door = [(COWL - 0.2, wlo), (COWL - 1.45, wlo), (COWL - 1.45, whi), (COWL - 0.2 - rake * (whi - wlo), whi)]
    quarter = [(COWL - 1.6, wlo + 0.1), (COWL - 2.0, wlo + 0.1), (COWL - 2.0, whi), (COWL - 1.6, whi)]
    for name, prof in (("door_glass", door), ("quarter_glass", quarter)):
        prism(kit, f"{name}_l", prof, side_y + 0.015, side_y + 0.045, "glass")
        prism(kit, f"{name}_r", prof, -side_y - 0.045, -side_y - 0.015, "glass")
    for s, sy in (("l", 1), ("r", -1)):
        kit.box(f"mirror_{s}", (0.1, 0.08, 0.14), (COWL - 0.05, sy * (SIDE - 0.05), HOOD + 0.3), "under")
    mirrored(kit, "taillight", (INSET, 0.14, 0.34), BACK - INSET / 2, SIDE - 0.16, 0.38, "red")
    kit.box("rear_bumper", (0.08, 2 * SIDE, 0.2), (BACK + 0.03, 0, -0.1), "under")


def nose(kit: Kit) -> None:
    """A full-width dark grille with round headlamps inset at each end, lamp blocks at the hood corners and a thick bumper."""
    kit.box("grille", (0.06, 2 * (SIDE - 0.12), 0.34), (FRONT - 0.02, 0, 0.36), "under")
    for s, sy in (("l", 1), ("r", -1)):
        kit.cylinder(f"lamp_{s}", 0.13, 0.06, (FRONT + 0.0, sy * (SIDE - 0.28), 0.36), "light", rot=(0, math.pi / 2, 0), vertices=8)
        kit.box(f"corner_lamp_{s}", (0.06, 0.26, 0.1), (FRONT - 0.02, sy * (SIDE - 0.2), HOOD - 0.07), "light")
    kit.box("bumper", (0.12, 2 * SIDE, 0.22), (FRONT - 0.03, 0, 0.0), "under")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    lower_body(kit)
    cabin(kit)
    nose(kit)
    bay = {(x, y): BAY_FLOOR for x in (1, 2) for y in (0, 1)}
    level_sockets(kit, G, "row", [HOOD] * 2 + [ROOF] * 5, fronts={2: COWL - SCREEN_TOP}, cells=bay)
    level_sockets(kit, G, "floor", [G.top] * G.rows, cells=bay)
    check_base(kit, "base_niva", G)
    kit.export("base_niva", args, view_size=6.0)


if __name__ == "__main__":
    main()
