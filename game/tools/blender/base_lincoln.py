"""The lincoln base: a stylized 1969 Lincoln Continental Mark III, the long-hood hardtop coupe.

Grid: 5 columns by 11 rows, 2.42 m across by 7.15 m along. Half height 0.35 m, from PHYSICS.bodies.lincoln.
The ground is 1.02 m below the center, so the roof at 0.54 m stands 1.56 m tall, 4.4 times shorter than the car is long.
One long low slab body with a straight beltline at 0.10 m. The hood runs 41 % of the length back to the upright windshield at x 0.63,
with a low center ridge and a cutout over the engine cells, an upright chrome grille standing proud of the nose between squared fender ends,
and a chrome wrap bumper. The hardtop greenhouse is narrower than the body, in dark vinyl: the windshield stands upright because guns on the roof cells need a step, not a slope,
the roof runs back to -0.97 and a thick C-pillar slopes to the trunk lid at -1.62. The trunk is the last 27 %.
Wheels sit on rows 1 and 9 in the outer columns, radius 0.42 m, half width 0.17 m, mount 0.2 m below the center. Arches are cut on them.
The sockets arch_front, arch_rear (the left arch center at the hub) and arch_front_top (its crown) let wheelArches.test.ts check them against physics.
The sill hangs 0.15 m below the collider bottom as skin only.
Run: blender --background --python tools/blender/base_lincoln.py -- public/models/base_lincoln.glb [tmp/base_lincoln.png]
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
    hull_mesh,
    level_sockets,
    surface_z,
)

SEED = 314
G = Grid(rows=11, cols=5, half_height=0.35)
WHEEL_X = 1.95  # PHYSICS.bodies.lincoln.wheelX
WHEEL_Y = -0.2  # PHYSICS.bodies.lincoln.wheelY
WHEEL_R = 0.42  # PHYSICS.bodies.lincoln.wheelRadius
WHEEL_HALF_W = 0.17  # PHYSICS.bodies.lincoln.wheelHalfWidth
HUB_Z = WHEEL_Y - SUSPENSION_REST
WHEELS_X = [WHEEL_X, -WHEEL_X]
WELL_Y = G.col_y(0) - WHEEL_HALF_W - 0.03  # the wheel wells' inner wall

SIDE = G.half_y - INSET  # body side outer face
FRONT = G.half_x - INSET  # nose face
BACK = -G.half_x + INSET  # tail face
SILL = -0.72  # skin only, below the collider bottom
DECK = 0.1  # the beltline: hood, fender tops and trunk lid
ROOF = 0.54  # the roof's flat top, where items on the cab cells stand
COWL = 0.63  # the windshield base: upright, because guns on the roof cells need a step, not a slope
ROOF_FRONT = 0.63  # the windshield top
ROOF_BACK = -0.97  # the roof's flat top ends here
REAR_BASE = -1.62  # the C-pillar meets the trunk lid here, the row 7 and 8 line
BAY_FRONT = G.row_x(1.5)  # the engine cutout covers rows 2 and 3, columns 1 and 2
BAY_BACK = 1.0
BAY_LEFT = G.col_y(0.5)
BAY_RIGHT = G.col_y(2.5)
BAY_FLOOR = -0.25  # a 0.5 m engine pokes 0.35 m out of the cutout
CAB_BELT_Y = 0.76  # the greenhouse half width at the beltline: it covers the third column from the center and no more
CAB_ROOF_Y = 0.72  # and at the roof


def mirrored(kit: Kit, name: str, size: tuple[float, float, float], x: float, y: float, z: float, mat: str) -> None:
    """A box on the left side at +y and its twin on the right side."""
    kit.box(f"{name}_l", size, (x, y, z), mat)
    kit.box(f"{name}_r", size, (x, -y, z), mat)


def cab_y(z: float) -> float:
    """The greenhouse half width at height z."""
    return CAB_BELT_Y + (CAB_ROOF_Y - CAB_BELT_Y) * (z - DECK) / (ROOF - DECK)


def windshield_x(z: float) -> float:
    """X of the windshield plane at height z, constant while the windshield is upright."""
    return COWL + (ROOF_FRONT - COWL) * (z - DECK) / (ROOF - DECK)


def rear_x(z: float) -> float:
    """X of the sloped C-pillar and rear window plane at height z."""
    return REAR_BASE + (ROOF_BACK - REAR_BASE) * (z - DECK) / (ROOF - DECK)


def lower_body(kit: Kit) -> None:
    """The slab body up to the beltline with arches cut on the wheels and the engine cutout, flares and trim."""
    low = hull_layers("lower", [(SILL, FRONT, BACK, SIDE, 0.12), (DECK - 0.04, FRONT, BACK, SIDE, 0.12), (DECK, FRONT - 0.02, BACK + 0.02, SIDE - 0.03, 0.12)])
    arch_cut(low, WHEELS_X, HUB_Z, WHEEL_R, WELL_Y, SILL)
    cut_boxes(low, [((BAY_BACK, BAY_RIGHT, BAY_FLOOR), (BAY_FRONT, BAY_LEFT, DECK + 0.2))])
    low.data.materials.clear()  # the booleans leave an empty slot, which would take the faces off the paint
    kit._add(low, "lower", "paint", 0.0)
    for i, wx in enumerate(WHEELS_X):
        flare(kit, f"flare{i}_l", G, wx, HUB_Z, WHEEL_R, SIDE, G.half_y, SILL)
        flare(kit, f"flare{i}_r", G, wx, HUB_Z, WHEEL_R, -G.half_y, -SIDE, SILL)
    # Light rocker trim between the wheels, and a low ridge down the hood in front of the engine cutout.
    mirrored(kit, "rocker", (2 * WHEEL_X - 2 * (WHEEL_R + 0.1), 0.03, 0.06), 0.0, SIDE + 0.015, -0.5, "metal_light")
    kit.box("ridge", (FRONT - BAY_FRONT - 0.1, 0.5, 0.03), ((FRONT + BAY_FRONT) / 2 - 0.05, 0, DECK + 0.015), "paint")


def glass(kit: Kit, name: str, corners: list[tuple[float, float]], mirror: bool, depth: float) -> None:
    """A dark pane lying on the greenhouse: corners are (x, z) points, widened to the surface across and standing depth out."""
    for sign in (1, -1) if mirror else (1,):
        pts = [(x, sign * (cab_y(z) + dy), z) for x, z in corners for dy in (0.0, depth)]
        kit._add(hull_mesh(f"{name}_{'l' if sign > 0 else 'r'}", pts), f"{name}_{'l' if sign > 0 else 'r'}", "glass", 0.0)


def greenhouse(kit: Kit) -> None:
    """A low hardtop cabin in dark vinyl, narrower than the body, with glass set into it: windshield, side windows and a rear window."""
    layers = [
        (DECK - 0.02, COWL, REAR_BASE, CAB_BELT_Y, 0.02),
        (ROOF, ROOF_FRONT, ROOF_BACK, CAB_ROOF_Y, 0.02),
    ]
    kit._add(hull_layers("cabin", layers), "cabin", "under", 0.0)
    lo, hi = DECK + 0.07, ROOF - 0.07
    for name, plane, sign in (("windshield", windshield_x, 0.005), ("rear_glass", rear_x, -0.005)):
        pts = []
        for z in (lo, hi):
            for y in (cab_y(z) - 0.3, -cab_y(z) + 0.3):
                pts += [(plane(z), y, z), (plane(z) + sign, y, z)]
        kit._add(hull_mesh(name, pts), name, "glass", 0.0)
    # Side windows in the door and the quarter, leaving a thick C-pillar of vinyl behind them.
    window = [(windshield_x(lo) - 0.25, lo), (rear_x(lo) + 0.85, lo), (rear_x(hi) + 0.85, hi), (windshield_x(hi) - 0.25, hi)]
    glass(kit, "side_glass", window, True, 0.02)


def nose(kit: Kit) -> None:
    """The chrome grille standing proud of the nose, squared fender ends with flat faces and lamps, and the wrap bumper."""
    kit.box("grille", (0.08, 0.62, 0.42), (FRONT - 0.02, 0, DECK - 0.12), "metal_light")
    kit.box("grille_header", (0.1, 0.72, 0.06), (FRONT - 0.03, 0, DECK + 0.12), "metal_light")
    for s, sy in (("l", 1), ("r", -1)):
        kit.box(f"fender_face_{s}", (0.04, 0.5, 0.3), (FRONT - 0.02, sy * 0.78, DECK - 0.14), "paint")
        kit.box(f"lamp_{s}", (0.05, 0.14, 0.14), (FRONT - 0.02, sy * (SIDE - 0.1), DECK - 0.1), "light")
        kit.box(f"wrap_{s}", (0.7, 0.07, 0.22), (FRONT - 0.37, sy * (SIDE - 0.02), -0.4), "metal_light")
    kit.box("bumper", (0.14, 2 * SIDE, 0.22), (FRONT - 0.04, 0, -0.4), "metal_light")
    kit.box("rear_bumper", (0.12, 2 * SIDE, 0.22), (BACK + 0.04, 0, -0.4), "metal_light")
    mirrored(kit, "taillight", (INSET, 0.5, 0.12), BACK - INSET / 2 + 0.02, SIDE - 0.4, DECK - 0.12, "red")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    lower_body(kit)
    greenhouse(kit)
    nose(kit)
    kit.socket("arch_front", (WHEEL_X, G.col_y(0), HUB_Z))
    kit.socket("arch_rear", (-WHEEL_X, G.col_y(0), HUB_Z))
    kit.socket("arch_front_top", (WHEEL_X, G.col_y(0), HUB_Z + WHEEL_R + ARCH_CLEARANCE))
    # The rear window row lies on a slope.
    slopes = {(x, 7): surface_z(G, x, 7) for x in range(G.cols)}
    bay = {(x, y): BAY_FLOOR for x in (1, 2) for y in (2, 3)}
    level_sockets(kit, G, "row", [DECK] * 4 + [ROOF] * 3 + [DECK] * 4, fronts={4: ROOF_FRONT}, cells=slopes | bay)
    level_sockets(kit, G, "floor", [G.top] * G.rows, cells=bay)
    check_base(kit, "base_lincoln", G)
    kit.export("base_lincoln", args, view_size=8.5)


if __name__ == "__main__":
    main()
