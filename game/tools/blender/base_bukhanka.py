"""The bukhanka base: a stylized UAZ-452 "loaf" van, the one-box cab-over with no hood.

Grid: 5 columns by 8 rows, 2.42 m across by 5.2 m along. Half height 0.5 m, from PHYSICS.bodies.bukhanka.
The ground is 1.30 m below the center, so the level roof at 1.20 m stands 2.5 m tall.
One tall closed box from nose to tail with a roof rounded on every edge and level for its whole length, chamfered plan corners and a little tumblehome.
A low rounded nose panel carries two wide-set round lamps and a dark grille, and bulges 0.1 m ahead of the windshield base.
Over it a wide two-piece windshield rakes back. Behind it a door window and three equal side windows run in a band from 67 % to 86 % of the height.
The engine stands in a sunk hatch in the roof on rows 3 and 4 (PHYSICS.bodies.bukhanka.engine), standing in for the doghouse between the seats.
Wheels sit on rows 1 and 6 in the outer columns, radius 0.55 m, half width 0.2 m, mount 0.35 m below the center. Arches are cut on them.
The sockets arch_front, arch_rear (the left arch center at the hub) and arch_front_top (its crown) let wheelArches.test.ts check them against physics.
The sill hangs 0.1 m below the collider bottom as skin only.
Run: blender --background --python tools/blender/base_bukhanka.py -- public/models/base_bukhanka.glb [tmp/base_bukhanka.png]
"""

from __future__ import annotations

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

SEED = 312
G = Grid(rows=8, cols=5, half_height=0.5)
WHEEL_X = 1.45  # PHYSICS.bodies.bukhanka.wheelX
WHEEL_Y = -0.35  # PHYSICS.bodies.bukhanka.wheelY
WHEEL_R = 0.55  # PHYSICS.bodies.bukhanka.wheelRadius
WHEEL_HALF_W = 0.2  # PHYSICS.bodies.bukhanka.wheelHalfWidth
HUB_Z = WHEEL_Y - SUSPENSION_REST
WHEELS_X = [WHEEL_X, -WHEEL_X]
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
SILL = -0.82  # skin only, below the collider bottom
BELT = 0.36  # the lower body ends here and the glazed box begins
ROOF = 1.2  # the flat roof, every row's surface
CHAMFER = 0.2  # the plan corners
HATCH_FRONT = 1.04  # the engine hatch covers game rows 3 and 4, columns 1 and 2
HATCH_BACK = 0.0
HATCH_LEFT = G.col_y(0.5)
HATCH_RIGHT = G.col_y(2.5)
BAY_FLOOR = ROOF - 0.2  # a 0.5 m engine pokes 0.3 m out of the hatch
WIN_BOTTOM = 0.4
WIN_TOP = 0.83
DOOR_WINDOW = (G.row_x(0.75), G.row_x(0.75) - 0.7)
SIDE_WINDOWS = [(0.2, 0.95), (-0.8, -0.05), (-1.8, -1.05)]  # three equal windows behind the door
LAMP_Y = 0.72  # headlamp centers across, from the center line
LAMP_Z = 0.0  # about 52 % of the height


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def lower_body(kit: Kit) -> None:
    """The tall flat side panels and the nose panel, with arches cut on the wheels, flares and bumpers."""
    low = hull_layers("lower", [(SILL, FRONT, BACK, SIDE, CHAMFER), (BELT - 0.06, FRONT, BACK, SIDE, CHAMFER), (BELT, FRONT - 0.07, BACK + 0.04, SIDE - 0.04, CHAMFER)])
    arch_cut(low, WHEELS_X, HUB_Z, WHEEL_R, WELL_Y, SILL)
    low.data.materials.clear()  # the boolean leaves an empty slot, which would take the faces off the paint
    kit._add(low, "lower", "paint", 0.0)
    for i, wx in enumerate(WHEELS_X):
        flare(kit, f"flare{i}_l", G, wx, HUB_Z, WHEEL_R, SIDE, G.half_y, SILL)
        flare(kit, f"flare{i}_r", G, wx, HUB_Z, WHEEL_R, -G.half_y, -SIDE, SILL)
    kit.box("bumper", (0.12, 2 * SIDE - 0.2, 0.22), (FRONT - 0.02, 0, -0.52), "under")
    kit.box("rear_bumper", (0.1, 2 * SIDE - 0.2, 0.18), (BACK + 0.01, 0, -0.52), "under")


def loaf(kit: Kit) -> None:
    """The glazed box: a hull with a raked front, tumblehome and a roof rounded on every edge, and the engine hatch cut into the roof."""
    layers = [
        (BELT - 0.02, FRONT - 0.1, BACK + 0.04, SIDE - 0.04, CHAMFER),
        (0.9, FRONT - 0.27, BACK + 0.06, SIDE - 0.1, CHAMFER),
        (ROOF - 0.1, FRONT - 0.36, BACK + 0.14, SIDE - 0.15, CHAMFER),
        (ROOF, FRONT - 0.46, BACK + 0.34, SIDE - 0.26, CHAMFER),
    ]
    obj = hull_layers("loaf", layers)
    cut_boxes(obj, [((HATCH_BACK, HATCH_RIGHT, BAY_FLOOR), (HATCH_FRONT, HATCH_LEFT, ROOF + 0.2))])
    obj.data.materials.clear()
    kit._add(obj, "loaf", "paint", 0.0)


def glazing(kit: Kit) -> None:
    """A wide two-piece windshield, the door window and three equal side windows, dark on the paint."""
    shield_y = SIDE - 0.25
    rake = ((FRONT - 0.1) - (FRONT - 0.36)) / (ROOF - 0.1 - BELT)
    z0, z1 = BELT + 0.08, ROOF - 0.18
    x0, x1 = FRONT - 0.1 - rake * (z0 - BELT), FRONT - 0.1 - rake * (z1 - BELT)
    for s, (y0, y1) in (("l", (0.05, shield_y)), ("r", (-shield_y, -0.05))):
        kit.box(
            f"windshield_{s}",
            (0.03, y1 - y0, z1 - z0),
            ((x0 + x1) / 2 + 0.005, (y0 + y1) / 2, (z0 + z1) / 2),
            "glass",
            rot=(0, -rake, 0),
        )
    for lo, hi in (DOOR_WINDOW, *SIDE_WINDOWS):
        mirrored(kit, f"window{lo:.2f}", (abs(hi - lo), 0.03, WIN_TOP - WIN_BOTTOM), (lo + hi) / 2, SIDE - 0.035, (WIN_TOP + WIN_BOTTOM) / 2, "glass")


def front_face(kit: Kit) -> None:
    """Wide-set round headlamps, small lamps below them and a dark low grille panel between."""
    for s, sy in (("l", 1), ("r", -1)):
        kit.cylinder(f"lamp_{s}", 0.15, 0.06, (FRONT - 0.03, sy * LAMP_Y, LAMP_Z), "light", rot=(0, 1.5708, 0), vertices=8)
        kit.box(f"lamp_small_{s}", (0.05, 0.12, 0.1), (FRONT - 0.01, sy * (LAMP_Y + 0.0), LAMP_Z - 0.3), "light")
    kit.box("grille", (0.06, 0.7, 0.4), (FRONT - 0.01, 0, -0.27), "under")
    mirrored(kit, "taillight", (INSET, 0.14, 0.3), BACK - INSET / 2 + 0.01, SIDE - 0.3, 0.0, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    lower_body(kit)
    loaf(kit)
    glazing(kit)
    front_face(kit)
    kit.socket("arch_front", (WHEEL_X, G.col_y(0), HUB_Z))
    kit.socket("arch_rear", (-WHEEL_X, G.col_y(0), HUB_Z))
    kit.socket("arch_front_top", (WHEEL_X, G.col_y(0), HUB_Z + WHEEL_R + ARCH_CLEARANCE))
    bay = {(x, y): BAY_FLOOR for x in (1, 2) for y in (2, 3)}
    level_sockets(kit, G, "row", [ROOF] * G.rows, fronts={0: FRONT - 0.46}, cells=bay)
    level_sockets(kit, G, "floor", [G.top] * G.rows, cells=bay)
    check_base(kit, "base_bukhanka", G)
    kit.export("base_bukhanka", args, view_size=7.0)


if __name__ == "__main__":
    main()
