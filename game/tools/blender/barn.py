"""Old timber barn of the orchard farm: a gable with a big open door, holes in its sheet roof and a lean-to.

Built at its in-game size: the barn is 24 m along X and 12 m across, 6.4 m to the eaves and 10 m to the ridge, and
the lean-to on its +Y side reaches 4 m further out, so the whole barn is 24 x 16 m, about 3 army trucks long. Its
footprint radius is 14.7 m, the reach of the open door leaf; the corners reach 14.4 m. The orchard's shed is this
model at a smaller pose scale. The door gable faces +X.
Run: blender --background --python tools/blender/barn.py -- public/models/barn.glb [tmp/barn.png]
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
    "plank": 0x8E7454,  # PAL.wall.side, weathered boards
    "plank_dark": 0x6A5840,  # PAL.wall.dark
    "roof": 0x6E6254,  # PAL.rock.side, grey sheet roof
    "roof_rust": 0x5E3420,  # PAL.rust.side
    "rafter": 0x6A4A2A,  # PAL.trunk
    "dark": 0x2A1A10,  # PAL.shadow
    "crate": 0x9A7A4A,  # PAL.crate
}
SEED = 79
HALF_L = 12.0  # m, half the barn's length along X
HALF_W = 6.0  # m, half its width along Y
EAVE = 6.4  # m
RIDGE = 10.0  # m
DOOR_HALF = 3.3  # m, half the door's width
DOOR_H = 5.2  # m
WALL = 0.2  # m
PANELS = 6  # roof panels per slope along X
LEAN = 4.0  # m, how far the lean-to reaches out from the +Y wall
HOLES = (0, 1)  # panels missing from the -Y slope, toward the back


def along_x(obj) -> None:
    """prism() extrudes along Blender Y; this turns a part so its extrusion runs along +X."""
    obj.rotation_euler = (0, 0, math.radians(-90))


def gable(half: float, low: float, high: float) -> list[tuple[float, float]]:
    """A closed gable-end profile in (across, up): a wall to the eaves and the roof triangle on it."""
    return [(-half, 0.0), (half, 0.0), (half, low), (0.0, high), (-half, low)]


def build(kit: Kit) -> None:
    # Dark inside, seen through the door and the roof holes.
    along_x(prism(kit, "inside", gable(HALF_W - 0.2, EAVE - 0.1, RIDGE - 0.3), -HALF_L + 0.2, HALF_L - 0.2, "dark"))
    # Long walls, the back gable, and the front gable cut around the door.
    for s in (-1, 1):
        kit.box(f"wall{s:+d}", (2 * HALF_L, WALL, EAVE), (0, s * (HALF_W - WALL / 2), EAVE / 2), "plank", dent_by=0.03)
    along_x(prism(kit, "gable_back", gable(HALF_W, EAVE, RIDGE), -HALF_L, -HALF_L + WALL, "plank"))
    # prism() caps each end with one face, so the door notch is built as three convex pieces instead.
    along_x(prism(kit, "gable_front_top", [(-HALF_W, DOOR_H), (HALF_W, DOOR_H), (HALF_W, EAVE), (0.0, RIDGE), (-HALF_W, EAVE)], HALF_L - WALL, HALF_L, "plank"))
    for s in (-1, 1):
        y0, y1 = sorted((s * DOOR_HALF, s * HALF_W))
        kit.box(f"gable_front_side{s:+d}", (WALL, y1 - y0, DOOR_H), (HALF_L - WALL / 2, (y0 + y1) / 2, DOOR_H / 2), "plank", dent_by=0.02)
    # Vertical battens on the front gable and a door frame, so the boards read.
    for i, y in enumerate((-5.2, -4.3, 4.3, 5.2, -1.6, 0.0, 1.6)):
        top = EAVE + (RIDGE - EAVE) * (1 - abs(y) / HALF_W) - 0.2
        bottom = 0.0 if abs(y) > DOOR_HALF else DOOR_H
        kit.box(f"batten{i}", (0.08, 0.16, top - bottom), (HALF_L + 0.03, y, (top + bottom) / 2), "plank_dark")
    kit.box("door_beam", (0.3, 2 * DOOR_HALF + 0.6, 0.35), (HALF_L + 0.08, 0, DOOR_H + 0.15), "rafter")
    # The open door leaf, hinged at the door's -Y edge and swung out 70 degrees.
    leaf, swing = DOOR_HALF - 0.1, math.radians(-70)
    hinge = (HALF_L + 0.05, -DOOR_HALF)
    leaf_at = (hinge[0] + math.cos(swing) * leaf / 2, hinge[1] + math.sin(swing) * leaf / 2, (DOOR_H - 0.3) / 2)
    kit.box("door_leaf", (leaf, 0.12, DOOR_H - 0.3), leaf_at, "plank_dark", rot=(0, 0, swing), dent_by=0.04)
    # Two roof slopes in panels, with holes in the -Y slope over bare rafters.
    pitch = math.atan2(RIDGE - EAVE, HALF_W)
    slope = math.hypot(HALF_W, RIDGE - EAVE) + 0.5
    panel = (2 * HALF_L + 0.6) / PANELS
    for s in (-1, 1):
        cy = s * (HALF_W / 2 + 0.15 * math.sin(pitch))
        cz = (EAVE + RIDGE) / 2 + 0.1
        for i in range(PANELS):
            x = -HALF_L - 0.3 + panel * (i + 0.5)
            if s == -1 and i in HOLES:
                continue
            mat = "roof_rust" if (i + (s > 0)) % 3 == 0 else "roof"
            kit.box(f"roof{s:+d}_{i}", (panel - 0.08, slope, 0.15), (x, cy, cz), mat, rot=(-s * pitch, 0, 0), dent_by=0.06)
    for i in range(HOLES[0] * 3, (HOLES[-1] + 1) * 3 + 1):
        x = -HALF_L - 0.3 + panel * i / 3
        strut(kit, f"rafter{i}", (x, -HALF_W - 0.2, EAVE - 0.1), (x, 0.0, RIDGE + 0.05), 0.2, "rafter")
    kit.box("ridge_beam", (2 * HALF_L + 0.4, 0.3, 0.3), (0, 0, RIDGE), "rafter")
    # Lean-to on the +Y side: board walls under a shallow roof, open toward +X.
    lean = (HALF_W, HALF_W + LEAN)
    lean_x = (-8.0, 6.0)
    lean_hi, lean_lo = 5.6, 3.6
    mid_y = sum(lean) / 2
    kit.box("lean_back", (WALL, lean[1] - lean[0], lean_lo), (lean_x[0], mid_y, lean_lo / 2), "plank_dark", dent_by=0.03)
    kit.box("lean_side", (lean_x[1] - lean_x[0], WALL, lean_lo), ((lean_x[0] + lean_x[1]) / 2, lean[1], lean_lo / 2), "plank_dark", dent_by=0.03)
    kit.box("lean_floor", (lean_x[1] - lean_x[0], lean[1] - lean[0], 0.1), ((lean_x[0] + lean_x[1]) / 2, mid_y, 0.05), "dark")
    for i, x in enumerate((lean_x[1], lean_x[1] - 4.5)):
        kit.box(f"lean_post{i}", (0.3, 0.3, lean_lo), (x, lean[1] - 0.15, lean_lo / 2), "rafter")
    lean_pitch = math.atan2(lean_hi - lean_lo, lean[1] - lean[0])
    kit.box(
        "lean_roof",
        (lean_x[1] - lean_x[0] + 0.3, math.hypot(lean[1] - lean[0], lean_hi - lean_lo) + 0.3, 0.1),
        ((lean_x[0] + lean_x[1]) / 2, mid_y, (lean_hi + lean_lo) / 2 + 0.05),
        "roof",
        rot=(-lean_pitch, 0, 0),
        dent_by=0.04,
    )
    # A stack of crates by the door.
    for i, (x, y, z) in enumerate(((HALF_L + 1.0, HALF_W - 0.5, 0.4), (HALF_L + 1.0, HALF_W - 1.4, 0.4), (HALF_L + 1.0, HALF_W - 0.95, 1.2))):
        kit.box(f"crate{i}", (0.8, 0.8, 0.8), (x, y, z), "crate", rot=(0, 0, kit.rng.uniform(-0.2, 0.2)), dent_by=0.03)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("barn", args, view_size=36)


if __name__ == "__main__":
    main()
