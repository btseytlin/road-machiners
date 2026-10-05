"""Ruined two-storey farmhouse of the old orchard: a gabled main block with a collapsed roof and bare rafters, a
lower roofless wing with broken walls, and a rubble yard behind a low wall.

Built at its in-game size: everything stands within X -8.3..6.2 and Y -13.8..12.3, so the house with its wing and
yard is 26 m along Y and 14.5 m deep, 11 m tall to the chimney top. Its footprint radius is 16 m, the reach of the
yard's far corner. The main block is 13.8 m along Y and 9.8 m deep, 6.4 m to the eaves (two 3.2 m storeys) and
9.8 m to the ridge. The wing stands on its +Y end and juts 4.2 m toward the road, so the house is an L around the
yard. The road facade and the yard face +X.
Run: blender --background --python tools/blender/farmhouse.py -- public/models/farmhouse.glb [tmp/farmhouse.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import prism, strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "wall": 0xB89A74,  # PAL.wall.top, pale plaster
    "wall_side": 0x8E7454,  # PAL.wall.side
    "wall_dark": 0x6A5840,  # PAL.wall.dark
    "roof": 0x7A5A3A,  # PAL.roof[0]
    "rafter": 0x6A4A2A,  # PAL.trunk
    "hole": 0x2A1A10,  # PAL.shadow, window holes and the gutted inside
    "rubble": 0x9A8A78,  # PAL.rock.top
    "rubble_dark": 0x6E6254,  # PAL.rock.side
}
SEED = 83
WALL = 0.3  # m, wall thickness
STOREY = 3.2  # m
# Main block, in meters: front and back faces along X, ends along Y.
MAIN_X = (-8.2, 1.6)
MAIN_Y = (-13.4, 0.4)
EAVE = 2 * STOREY
RIDGE = 9.8
RAFTER_END = -4.9  # m along Y: the front roof slope is gone from MAIN_Y[0] to here, leaving bare rafters
# Wing, lower and roofless, on the main block's +Y end, jutting toward the road.
WING_X = (-4.0, 5.8)
WING_Y = (0.4, 12.2)


def window(kit: Kit, name: str, x: float, y: float, z: float, facing_x: bool, w: float = 0.9, h: float = 1.3) -> None:
    """A dark window hole on a wall face. facing_x puts it on a face whose normal is X, otherwise Y."""
    size = (0.06, w, h) if facing_x else (w, 0.06, h)
    kit.box(name, size, (x, y, z), "hole")


def main_block(kit: Kit) -> None:
    x0, x1 = MAIN_X
    y0, y1 = MAIN_Y
    xc = (x0 + x1) / 2
    # The gutted inside, dark under the broken roof.
    kit.box("inside", (x1 - x0 - 0.2, y1 - y0 - 0.2, EAVE - 0.1), (xc, (y0 + y1) / 2, EAVE / 2), "hole")
    prism(kit, "inside_gable", [(x0 + 0.3, EAVE - 0.1), (x1 - 0.3, EAVE - 0.1), (xc, RIDGE - 0.3)], y0 + 0.2, y1 - 0.2, "hole")
    # Four walls and the two gable triangles.
    kit.box("front", (WALL, y1 - y0, EAVE), (x1 - WALL / 2, (y0 + y1) / 2, EAVE / 2), "wall", dent_by=0.03)
    kit.box("back", (WALL, y1 - y0, EAVE), (x0 + WALL / 2, (y0 + y1) / 2, EAVE / 2), "wall_side", dent_by=0.03)
    for name, y in (("end_left", y0 + WALL / 2), ("end_right", y1 - WALL / 2)):
        kit.box(name, (x1 - x0, WALL, EAVE), (xc, y, EAVE / 2), "wall_side", dent_by=0.03)
    for name, (a, b) in (("gable_left", (y0, y0 + WALL)), ("gable_right", (y1 - WALL, y1))):
        prism(kit, name, [(x0, EAVE), (x1, EAVE), (xc, RIDGE)], a, b, "wall_side")
    # Windows on two storeys: four along the road facade, two on the left gable end, three at the back.
    for row, z in enumerate((1.7, STOREY + 1.6)):
        for i, y in enumerate((-11.3, -8.0, -4.7, -1.6)):
            if row == 0 and i == 2:
                kit.box("door", (0.06, 1.1, 2.2), (x1 + 0.01, y, 1.1), "hole")
                continue
            window(kit, f"win_front{row}{i}", x1 + 0.01, y, z, True)
        for i, x in enumerate((-5.9, -0.9)):
            window(kit, f"win_left{row}{i}", x, y0 - 0.01, z, False)
        for i, y in enumerate((-10.8, -6.2, -1.6)):
            window(kit, f"win_back{row}{i}", x0 - 0.01, y, z, True)
    window(kit, "win_attic", xc, y0 - 0.01, EAVE + 1.1, False, w=0.7, h=0.8)
    # Roof: the back slope whole, the front slope only from RAFTER_END to the right end, bare rafters elsewhere.
    pitch = math.atan2(RIDGE - EAVE, (x1 - x0) / 2)
    run = math.hypot((x1 - x0) / 2, RIDGE - EAVE) + 0.5
    zc = (EAVE + RIDGE) / 2 + 0.12
    kit.box("roof_back", (run, y1 - y0 + 0.4, 0.15), (x0 + (x1 - x0) / 4, (y0 + y1) / 2, zc), "roof", rot=(0, -pitch, 0), dent_by=0.05)
    kit.box("roof_front", (run, y1 - RAFTER_END + 0.3, 0.15), (x1 - (x1 - x0) / 4 + 0.2, (RAFTER_END + y1 + 0.3) / 2, zc), "roof", rot=(0, pitch, 0), dent_by=0.05)
    # A torn edge: a few loose sheets hanging off the remaining front slope over the hole.
    for i in range(3):
        y = RAFTER_END - 0.4 - i * 0.6
        kit.box(f"roof_torn{i}", (run * (0.7 - 0.2 * i), 0.6, 0.12), (x1 - (x1 - x0) / 4 + 0.6 + 0.3 * i, y, zc - 0.3 - 0.2 * i), "roof", rot=(0.1 * i, pitch + 0.15, 0), dent_by=0.04)
    count = 9
    for i in range(count):
        y = y0 + 0.2 + i * (RAFTER_END - 1.8 - y0) / (count - 1)
        strut(kit, f"rafter{i}", (x1 + 0.3, y, EAVE - 0.1), (xc, y, RIDGE), 0.16, "rafter")
    for i, t in enumerate((0.35, 0.7)):
        x = x1 + 0.3 + (xc - x1 - 0.3) * t
        z = EAVE - 0.1 + (RIDGE - EAVE + 0.1) * t
        strut(kit, f"purlin{i}", (x, y0 - 0.2, z + 0.12), (x, RAFTER_END, z + 0.12), 0.14, "rafter")
    strut(kit, "ridge_beam", (xc, y0 - 0.3, RIDGE + 0.05), (xc, y1 + 0.3, RIDGE + 0.05), 0.2, "rafter")
    kit.box("chimney", (1.0, 1.0, 2.6), (xc + 0.4, y1 - 1.0, RIDGE - 0.1), "wall_dark", dent_by=0.03)


def wing(kit: Kit) -> None:
    x0, x1 = WING_X
    y0, y1 = WING_Y
    # Broken front and back walls: panels of uneven height with window gaps.
    panels = 5
    step = (y1 - y0) / panels
    front = (4.2, 2.6, 3.8, 1.8, 3.4)
    back = (3.8, 4.2, 2.8, 3.4, 2.2)
    for i in range(panels):
        y = y0 + step * (i + 0.5)
        kit.box(f"wing_front{i}", (WALL, step, front[i]), (x1 - WALL / 2, y, front[i] / 2), "wall", dent_by=0.04)
        kit.box(f"wing_back{i}", (WALL, step, back[i]), (x0 + WALL / 2, y, back[i] / 2), "wall_side", dent_by=0.04)
        if front[i] > 2.6:
            window(kit, f"wing_win{i}", x1 + 0.01, y, 1.7, True)
    # The side wall toward the yard, where the wing juts past the main block's front, broken low.
    for i, (x, height) in enumerate(((MAIN_X[1] + 1.0, 2.8), (MAIN_X[1] + 3.0, 1.6))):
        kit.box(f"wing_side{i}", (2.0, WALL, height), (x, y0 + WALL / 2, height / 2), "wall_side", dent_by=0.04)
    # The broken gable at the far end, nearly as tall as the main block.
    prism(kit, "wing_end", [(x0, 0.0), (x1, 0.0), (x1, 3.8), (1.2, 6.4), (x0, 4.6)], y1 - WALL, y1, "wall_side")
    for i, x in enumerate((-1.6, 3.6)):
        window(kit, f"wing_end_win{i}", x, y1 + 0.01, 1.8, False)
    # Rubble heaps and fallen rafters inside the shell.
    for i in range(8):
        x = kit.rng.uniform(x0 + 0.8, x1 - 0.8)
        y = kit.rng.uniform(y0 + 0.8, y1 - 0.8)
        kit.box(f"wing_rubble{i}", (kit.rng.uniform(0.8, 1.6), kit.rng.uniform(0.8, 1.6), kit.rng.uniform(0.4, 0.9)), (x, y, 0.25), kit.rng.choice(("rubble", "rubble_dark")), rot=(0, 0, kit.rng.uniform(0, math.pi)), dent_by=0.08)
    strut(kit, "wing_beam0", (x0 + 0.3, y0 + 2.0, 3.4), (x1 - 0.5, y0 + 3.5, 0.3), 0.18, "rafter")
    strut(kit, "wing_beam1", (x0 + 0.5, y1 - 1.5, 0.2), (x1 - 0.3, y1 - 3.5, 2.8), 0.18, "rafter")


def yard(kit: Kit) -> None:
    # A low broken yard wall in front of the house, open toward the wing.
    for i, (y, length, height) in enumerate(((-12.3, 2.8, 1.0), (-8.7, 3.4, 0.7), (-4.2, 2.6, 1.1), (-1.0, 1.8, 0.5))):
        kit.box(f"yard_wall{i}", (0.35, length, height), (5.9, y, height / 2), "wall_side", dent_by=0.04)
    kit.box("yard_wall_side", (4.4, 0.35, 0.9), (3.8, -13.5, 0.45), "wall_side", dent_by=0.04)
    # Rubble spilled from the collapsed roof and walls across the yard.
    for i in range(13):
        x = kit.rng.uniform(2.4, 5.4)
        y = kit.rng.uniform(-12.8, -0.6)
        size = (kit.rng.uniform(0.4, 1.2), kit.rng.uniform(0.4, 1.2), kit.rng.uniform(0.2, 0.5))
        kit.box(f"yard_rubble{i}", size, (x, y, size[2] / 2 - 0.05), kit.rng.choice(("rubble", "rubble_dark", "wall_side")), rot=(0, 0, kit.rng.uniform(0, math.pi)), dent_by=0.06)
    for i in range(3):
        y = kit.rng.uniform(-10.8, -2.8)
        kit.box(f"yard_sheet{i}", (1.6, 1.0, 0.08), (kit.rng.uniform(2.6, 5.0), y, 0.1), "roof", rot=(kit.rng.uniform(-0.15, 0.15), 0.1, kit.rng.uniform(0, math.pi)), dent_by=0.04)


def build(kit: Kit) -> None:
    main_block(kit)
    wing(kit)
    yard(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("farmhouse", args, view_size=34)


if __name__ == "__main__":
    main()
