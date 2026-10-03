"""The bukhanka base: a stylized UAZ-452 "loaf" van, the one-box cab-over with no hood.

Grid: 5 columns by 8 rows, 2.42 m across by 5.2 m along. Half height 0.5 m, from PHYSICS.bodies.bukhanka.
One tall closed box from nose to tail with a near-vertical flat front and a roof rounded on every edge and level for its whole length.
The cab sits over the front wheels behind a wide windshield with a split bar, then one door window and a row of three equal side windows.
The engine stands in a sunk hatch in the roof on rows 2 and 3, standing in for the doghouse between the seats.
Wheels sit on rows 1 and 6 in the outer columns, radius 0.55 m, half width 0.2 m, mount 0.35 m below the center.
Run: blender --background --python tools/blender/base_bukhanka.py -- public/models/base_bukhanka.glb [tmp/base_bukhanka.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_base import BASE_COLORS, INSET, SUSPENSION_REST, Grid, arch_profile, check_base, cut_boxes, flare, hull_mesh, level_sockets  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 312
G = Grid(rows=8, cols=5, half_height=0.5)
WHEEL_R = 0.55
WHEEL_HALF_W = 0.2
HUB_Z = -0.35 - SUSPENSION_REST
WHEELS_X = [G.row_x(1), G.row_x(6)]
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
BELT = 0.95  # the lower body ends here and the glazed box begins
ROOF = 1.78  # the flat roof, every row's surface
ROUND_FRONT = 0.3  # the roof's rounding at the nose and tail
ROUND_SIDE = 0.22  # the roof's rounding along the sides
HATCH_FRONT = G.row_x(1.5)  # the engine hatch covers rows 2 and 3, columns 1 and 2
HATCH_BACK = G.row_x(3.5)
HATCH_LEFT = G.col_y(0.5)
HATCH_RIGHT = G.col_y(2.5)
BAY_FLOOR = ROOF - 0.22  # a 0.5 m engine pokes 0.28 m out of the hatch
WIN_BOTTOM = 1.18
WIN_TOP = ROOF - 0.2
DOOR_WINDOW = (G.row_x(0.75), G.row_x(0.75) - 0.7)
SIDE_WINDOWS = [(0.2, 0.95), (-0.8, -0.05), (-1.8, -1.05)]  # three equal windows behind the door
LAMP_Y = 0.88  # headlamp centers across, from the center line
LAMP_Z = 0.62


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def lower_body(kit: Kit) -> None:
    """Painted side panels with wheel arches up to the belt, a core between the wells, flares and a skid."""
    profile = arch_profile(G, WHEELS_X, HUB_Z, WHEEL_R, BELT)
    prism(kit, "skin_l", profile, WELL_Y, SIDE, "paint")
    prism(kit, "skin_r", profile, -SIDE, -WELL_Y, "paint")
    kit.box("core", (FRONT - BACK - 0.08, 2 * WELL_Y, BELT - G.bottom), (0, 0, (BELT + G.bottom) / 2), "metal")
    for i, wx in enumerate(WHEELS_X):
        flare(kit, f"flare{i}_l", G, wx, HUB_Z, WHEEL_R, SIDE, G.half_y)
        flare(kit, f"flare{i}_r", G, wx, HUB_Z, WHEEL_R, -G.half_y, -SIDE)
    kit.box("bumper", (0.1, 2 * SIDE, 0.22), (FRONT - 0.01, 0, -0.1), "under")
    kit.box("rear_bumper", (0.1, 2 * SIDE, 0.18), (BACK + 0.01, 0, -0.12), "under")


def loaf(kit: Kit) -> None:
    """The glazed box: a hull with a rounded roof on every edge, and the engine hatch cut into the roof."""
    pts = []
    for z, fx, sy in ((BELT, 0.0, 0.0), (ROOF - 0.4, 0.0, 0.0), (ROOF, ROUND_FRONT, ROUND_SIDE)):
        for x in (FRONT - fx, BACK + fx):
            for y in (SIDE - sy, -SIDE + sy):
                pts.append((x, y, z))
    obj = hull_mesh("loaf", pts)
    cut_boxes(obj, [((HATCH_BACK, HATCH_RIGHT, BAY_FLOOR), (HATCH_FRONT, HATCH_LEFT, ROOF + 0.2))])
    obj.data.materials.clear()  # the boolean leaves an empty slot, which would take the faces off the paint
    kit._add(obj, "loaf", "paint", 0.0)


def glazing(kit: Kit) -> None:
    """A wide two-piece windshield, the door window and three equal side windows, dark on the paint."""
    shield_y = SIDE - 0.2
    for s, (y0, y1) in (("l", (0.05, shield_y)), ("r", (-shield_y, -0.05))):
        kit.box(f"windshield_{s}", (0.03, y1 - y0, 0.5), (FRONT - 0.005, (y0 + y1) / 2, 1.38), "glass")
    for lo, hi in (DOOR_WINDOW, *SIDE_WINDOWS):
        mirrored(kit, f"window{lo:.2f}", (hi - lo if hi > lo else lo - hi, 0.03, WIN_TOP - WIN_BOTTOM), (lo + hi) / 2, SIDE + 0.005, (WIN_TOP + WIN_BOTTOM) / 2, "glass")


def front_face(kit: Kit) -> None:
    """Wide-set round headlamps at the corners, small lamps below them and a dark grille panel between."""
    for s, sy in (("l", 1), ("r", -1)):
        kit.cylinder(f"lamp_{s}", 0.15, 0.06, (FRONT, sy * LAMP_Y, LAMP_Z), "light", rot=(0, 1.5708, 0), vertices=8)
        kit.box(f"lamp_small_{s}", (0.05, 0.12, 0.1), (FRONT - 0.005, sy * (LAMP_Y - 0.06), LAMP_Z - 0.28), "light")
    kit.box("grille", (0.05, 0.62, 0.34), (FRONT - 0.005, 0, 0.45), "under")
    mirrored(kit, "taillight", (INSET, 0.14, 0.3), BACK - INSET / 2, SIDE - 0.14, 0.5, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    lower_body(kit)
    loaf(kit)
    glazing(kit)
    front_face(kit)
    bay = {(x, y): BAY_FLOOR for x in (1, 2) for y in (2, 3)}
    level_sockets(kit, G, "row", [ROOF] * G.rows, fronts={0: FRONT - ROUND_FRONT}, cells=bay)
    level_sockets(kit, G, "floor", [G.top] * G.rows, cells=bay)
    check_base(kit, "base_bukhanka", G)
    kit.export("base_bukhanka", args, view_size=7.0)


if __name__ == "__main__":
    main()
