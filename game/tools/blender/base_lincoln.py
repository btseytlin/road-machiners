"""The lincoln base: a stylized 1969 Lincoln Continental Mark III, the long-hood hardtop coupe.

Grid: 5 columns by 11 rows, 2.42 m across by 7.15 m along. Half height 0.35 m, from PHYSICS.bodies.lincoln.
One long low slab body with a straight beltline. Rows 0 to 3 are a long flat hood with a raised center ridge and a cutout over the engine cells,
an upright chrome grille standing proud of the nose between squared fender ends, and a chrome wrap bumper.
Rows 4 to 6 are a low hardtop greenhouse under a dark vinyl roof with a thick C-pillar, rows 7 to 10 a trunk with a spare tire hump.
Wheels sit on rows 1 and 9 in the outer columns, radius 0.42 m, half width 0.17 m, mount 0.2 m below the center.
Run: blender --background --python tools/blender/base_lincoln.py -- public/models/base_lincoln.glb [tmp/base_lincoln.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import BASE_COLORS, INSET, SUSPENSION_REST, Grid, arch_profile, check_base, cut_boxes, flare, hull_mesh, level_sockets, surface_z  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 314
G = Grid(rows=11, cols=5, half_height=0.35)
WHEEL_R = 0.42
WHEEL_HALF_W = 0.17
HUB_Z = -0.2 - SUSPENSION_REST
WHEELS_X = [G.row_x(1), G.row_x(9)]
ARCH_Y = G.col_y(0)
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
DECK = 0.4  # the beltline: hood, fender tops and trunk lid
ROOF = 1.05  # the roof's flat top, where items on the cab cells stand
COWL = G.row_x(3.5)  # the windshield base, behind the hood rows
SCREEN_TOP = G.row_x(4.0) + 0.1  # the windshield top
ROOF_BACK = G.row_x(6.2)  # the roof's flat top ends here
REAR_BASE = G.row_x(7.6)  # the rear window meets the trunk lid here
BAY_FRONT = G.row_x(1.5)  # the engine cutout covers rows 2 and 3, columns 1 and 2
BAY_BACK = G.row_x(3.5)
BAY_LEFT = G.col_y(0.5)
BAY_RIGHT = G.col_y(2.5)
BAY_FLOOR = 0.0  # a 0.5 m engine pokes 0.5 m out of the cutout


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def lower_body(kit: Kit) -> None:
    """Side panels with wheel arches up to the beltline, the core with the engine cutout and the flares."""
    profile = arch_profile(G, WHEELS_X, HUB_Z, WHEEL_R, DECK)
    prism(kit, "skin_l", profile, WELL_Y, SIDE, "paint")
    prism(kit, "skin_r", profile, -SIDE, -WELL_Y, "paint")
    pts = [(x, y, z) for x in (FRONT, BACK) for y in (WELL_Y, -WELL_Y) for z in (G.bottom, DECK)]
    core = hull_mesh("core", pts)
    cut_boxes(core, [((BAY_BACK, BAY_RIGHT, BAY_FLOOR), (BAY_FRONT, BAY_LEFT, DECK + 0.2))])
    core.data.materials.clear()  # the boolean leaves an empty slot, which would take the faces off the paint
    kit._add(core, "core", "paint", 0.0)
    kit.box("bay_floor", (BAY_FRONT - BAY_BACK, BAY_LEFT - BAY_RIGHT, 0.02), ((BAY_FRONT + BAY_BACK) / 2, (BAY_LEFT + BAY_RIGHT) / 2, BAY_FLOOR + 0.01), "under")
    for i, wx in enumerate(WHEELS_X):
        flare(kit, f"flare{i}_l", G, wx, HUB_Z, WHEEL_R, SIDE, G.half_y)
        flare(kit, f"flare{i}_r", G, wx, HUB_Z, WHEEL_R, -G.half_y, -SIDE)
    # Light rocker trim between the wheels, and a ridge down the hood in front of the engine cutout.
    mid = (WHEELS_X[0] + WHEELS_X[1]) / 2
    mirrored(kit, "rocker", (WHEELS_X[0] - WHEELS_X[1] - 2 * (WHEEL_R + 0.1), 0.03, 0.06), mid, SIDE + 0.015, -0.12, "metal_light")
    kit.box("ridge", (BAY_FRONT - FRONT + 0.4, 0.5, 0.05), ((BAY_FRONT + FRONT - 0.4) / 2 + 0.2, 0, DECK + 0.025), "paint")
    kit.box("spare_hump", (0.7, 0.8, 0.1), (BACK + 0.65, 0, DECK + 0.05), "paint")


def greenhouse(kit: Kit) -> None:
    """A low hardtop cabin in dark vinyl with glass set into it: a raked windshield, side windows and a rear window."""
    pts = []
    for y in (SIDE - 0.1, -SIDE + 0.1):
        pts += [(COWL, y, DECK), (REAR_BASE, y, DECK)]
    for y in (SIDE - 0.28, -SIDE + 0.28):
        pts += [(SCREEN_TOP, y, ROOF), (ROOF_BACK, y, ROOF)]
    kit._add(hull_mesh("cabin", pts), "cabin", "under", 0.0)
    lo, hi = DECK + 0.05, ROOF - 0.07
    rake = (COWL - SCREEN_TOP) / (ROOF - DECK)
    shield = [(COWL - rake * (lo - DECK), lo), (COWL - rake * (lo - DECK) + 0.03, lo), (COWL - rake * (hi - DECK) + 0.03, hi), (COWL - rake * (hi - DECK), hi)]
    prism(kit, "windshield", shield, -SIDE + 0.32, SIDE - 0.32, "glass")
    back_rake = (REAR_BASE - ROOF_BACK) / (ROOF - DECK)
    rear = [(REAR_BASE - back_rake * (lo - DECK), lo), (REAR_BASE - back_rake * (lo - DECK) + 0.03, lo), (REAR_BASE - back_rake * (hi - DECK) + 0.03, hi), (REAR_BASE - back_rake * (hi - DECK), hi)]
    prism(kit, "rear_glass", [(x - 0.03, z) for x, z in rear], -SIDE + 0.5, SIDE - 0.5, "glass")
    # Side windows in the door and the quarter, leaving a thick C-pillar of vinyl behind them.
    side_y = SIDE - 0.1 - 0.05
    window = [(COWL - 0.22, lo), (ROOF_BACK + 0.35, lo), (ROOF_BACK + 0.55, hi), (SCREEN_TOP + 0.12, hi)]
    prism(kit, "side_glass_l", window, side_y, side_y + 0.05, "glass")
    prism(kit, "side_glass_r", window, -side_y - 0.05, -side_y, "glass")


def nose(kit: Kit) -> None:
    """The chrome grille standing proud of the nose, squared fender ends with flat faces and lamps, and the wrap bumper."""
    kit.box("grille", (0.08, 0.62, 0.42), (FRONT - 0.02, 0, DECK - 0.12), "metal_light")
    kit.box("grille_header", (0.1, 0.72, 0.06), (FRONT - 0.03, 0, DECK + 0.12), "metal_light")
    for s, sy in (("l", 1), ("r", -1)):
        kit.box(f"fender_face_{s}", (0.04, 0.5, 0.36), (FRONT - 0.02, sy * 0.78, DECK - 0.12), "paint")
        kit.box(f"lamp_{s}", (0.05, 0.14, 0.14), (FRONT - 0.02, sy * (SIDE - 0.1), DECK - 0.1), "light")
        kit.box(f"wrap_{s}", (0.7, 0.07, 0.2), (FRONT - 0.37, sy * (SIDE - 0.02), -0.2), "metal_light")
    kit.box("bumper", (0.14, 2 * SIDE, 0.2), (FRONT - 0.04, 0, -0.2), "metal_light")
    kit.box("rear_bumper", (0.12, 2 * SIDE, 0.2), (BACK + 0.04, 0, -0.2), "metal_light")
    mirrored(kit, "taillight", (INSET, 0.5, 0.12), BACK - INSET / 2 + 0.02, SIDE - 0.4, DECK - 0.12, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    lower_body(kit)
    greenhouse(kit)
    nose(kit)
    # The rear window row lies on a slope.
    slopes = {(x, 7): surface_z(G, x, 7) for x in range(G.cols)}
    bay = {(x, y): BAY_FLOOR for x in (1, 2) for y in (2, 3)}
    level_sockets(kit, G, "row", [DECK] * 4 + [ROOF] * 3 + [DECK] * 4, fronts={4: SCREEN_TOP}, cells=slopes | bay)
    level_sockets(kit, G, "floor", [G.top] * G.rows, cells=bay)
    check_base(kit, "base_lincoln", G)
    kit.export("base_lincoln", args, view_size=8.5)


if __name__ == "__main__":
    main()
