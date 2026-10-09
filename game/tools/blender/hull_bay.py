"""Hull bay: a compartment section torn out of the colony ship's hull, a loot spot of Fallen Sun.

Footprint radius 2.8 m: a floor 4.2 m long (x) and 3.2 m wide (y) with walls 1.9 m tall, an open roof and a hatch in the
+X wall. The walls are the hull's plate patchwork (hull, hull_grey, hull_dark, rust), with a jagged top where the roof
was ripped away. Lockers (locker, hull_dark) line the back wall and ship cargo (cargo_blue, cargo_orange) stands and
lies inside, so it shows from the iso camera at any yaw. The hatch faces +X, and the wall beside it stands lower so
the load shows from the open ground.
Run: blender --background --python tools/blender/hull_bay.py -- public/models/hull_bay.glb [tmp/hull_bay.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "hull": 0xC4BAA6,  # PAL.hull.light
    "hull_grey": 0x8E887C,  # PAL.hull.grey
    "hull_dark": 0x6E6A62,  # PAL.hull.dark
    "rust": 0x7E5634,  # PAL.hull.rust
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "soot": 0x1E1A18,
    "locker": 0x46606A,
    "cargo_blue": 0x3F8AA0,
    "cargo_orange": 0xC8742A,
    "ship_glow": 0x6FE4FF,  # PAL.shipGlow, painted emissive in the view
}
SEED = 281

LEN = 4.2  # m along x
WID = 3.2  # m along y
WALL = 0.3  # m thick
HIGH = 1.9  # m, wall height


def walls(kit: Kit) -> None:
    kit.box("floor", (LEN, WID, 0.25), (0, 0, 0.12), "soot")
    # Back wall in three plates of different tone, the middle one torn lower.
    for i, (y, w, h, mat) in enumerate(((-1.1, 1.2, HIGH, "hull_grey"), (0.0, 1.0, HIGH - 0.8, "hull_dark"), (1.1, 1.2, HIGH, "hull"))):
        kit.box(f"back{i}", (WALL, w, h), (-LEN / 2 + WALL / 2, y, h / 2), mat, dent_by=0.04)
    # Side walls, plated in two runs, each torn at a different height.
    for s, side in ((-1, "l"), (1, "r")):
        y = s * (WID / 2 - WALL / 2)
        kit.box(f"side_{side}0", (2.4, WALL, HIGH), (-1.1, y, HIGH / 2), "hull_grey" if s < 0 else "hull", dent_by=0.04)
        kit.box(f"side_{side}1", (2.0, WALL, HIGH - 0.9), (1.2, y, (HIGH - 0.9) / 2), "hull_dark", dent_by=0.04)
        kit.box(f"side_{side}_tear", (0.9, WALL, 0.4), (-0.9 + s * 0.5, y, HIGH + 0.05), "rust", rot=(0, math.radians(14 * s), 0), dent_by=0.05)
    # +X wall: two stubs either side of the hatch, low so the load shows.
    for s in (-1, 1):
        kit.box(f"jamb{s}", (WALL, 0.9, 1.1), (LEN / 2 - WALL / 2, s * 1.25, 0.55), "hull_dark", dent_by=0.03)
    kit.box("hatch_door", (0.12, 1.4, 0.9), (LEN / 2 + 0.15, -1.0, 0.35), "rust", rot=(0, math.radians(-20), math.radians(-24)), dent_by=0.03)


def load(kit: Kit) -> None:
    # Lockers along the back wall.
    for i, (y, h) in enumerate(((-1.0, 1.5), (-0.2, 1.1), (0.6, 1.5))):
        kit.box(f"locker{i}", (0.6, 0.7, h), (-LEN / 2 + WALL + 0.35, y, 0.25 + h / 2), "locker", dent_by=0.02)
    # Ship cargo: containers, one fallen over, and a glowing cell.
    kit.box("cargo0", (1.0, 1.0, 0.9), (-0.2, -0.8, 0.7), "cargo_blue", dent_by=0.02)
    kit.box("cargo1", (0.9, 0.9, 0.8), (-0.2, -0.8, 1.55), "cargo_orange", rot=(0, 0, math.radians(20)), dent_by=0.02)
    kit.box("cargo2", (0.9, 0.9, 0.8), (0.9, 0.55, 0.65), "cargo_orange", rot=(0, 0, math.radians(-15)), dent_by=0.02)
    kit.box("cargo3", (1.1, 0.7, 0.6), (1.5, -0.7, 0.55), "cargo_blue", rot=(math.radians(18), 0, math.radians(40)), dent_by=0.02)
    kit.cylinder("cell", 0.28, 0.7, (0.1, 0.9, 0.6), "ship_glow", vertices=8)


def build(kit: Kit) -> None:
    walls(kit)
    load(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("hull_bay", args, view_size=8.0)


if __name__ == "__main__":
    main()
