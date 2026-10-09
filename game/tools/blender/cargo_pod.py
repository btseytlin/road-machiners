"""Cargo pod: a ship cargo section that fell in the crash, split open along its top and at its +X end, a loot spot of Fallen Sun.

Footprint radius 2.8 m: a barrel 4.6 m long (x) and 2.4 m across, lying on its side and sunk a little into the sand. Its
top is torn away from the +X end back to the middle, so the load shows from the iso camera. Its skin is hull_grey and
hull_dark with rust ribs. The load is blue and orange cargo containers and spilled boxes, and it has none of the escape pod's
metal_light body or glowing beacon, so it never reads as a sealed pod on the trail.
Run: blender --background --python tools/blender/cargo_pod.py -- public/models/cargo_pod.glb [tmp/cargo_pod.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import arc_panel  # noqa: E402

COLORS = {
    "hull_grey": 0x8E887C,  # PAL.hull.grey
    "hull_dark": 0x6E6A62,  # PAL.hull.dark
    "rust": 0x7E5634,  # PAL.hull.rust
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "soot": 0x1E1A18,
    "cargo_blue": 0x3F8AA0,
    "cargo_orange": 0xC8742A,
    "cargo_pale": 0xD8CFB8,
}
SEED = 282

R = 1.2  # m, outer radius of the barrel
CZ = 1.0  # m, axis height, so the barrel sinks 0.2 m
X0, X1 = -2.3, 2.3
# Angles from the top, positive toward -Y: the shell is kept below these, so the top is open.
OPEN_FAR = math.radians(70)  # at the open +X half
OPEN_NEAR = math.radians(45)  # at the closed -X half


def shell(kit: Kit) -> None:
    # Closed back half: nearly the full ring, a slit left on top.
    arc_panel(kit, "back", X0, 0.2, OPEN_NEAR, 2 * math.pi - OPEN_NEAR, R, CZ, "hull_grey", thick=0.18, segs=10, tear=0.0, dent_by=0.03)
    # Open front half: only the lower shell, with a torn upper edge.
    arc_panel(kit, "front", 0.2, X1, OPEN_FAR, 2 * math.pi - OPEN_FAR, R, CZ, "hull_dark", thick=0.18, segs=8, tear=0.5, dent_by=0.03)
    # Ribs round the barrel and the end cap behind the load.
    for i, x in enumerate((X0 + 0.2, -0.8, 0.4, X1 - 0.2)):
        a = OPEN_NEAR if x < 0.2 else OPEN_FAR
        arc_panel(kit, f"rib{i}", x - 0.15, x + 0.15, a, 2 * math.pi - a, R + 0.08, CZ, "rust", thick=0.3, segs=10)
    kit.cylinder("cap", R, 0.2, (X0 - 0.05, 0, CZ), "rust_dark", rot=(0, math.radians(90), 0), vertices=10)


def load(kit: Kit) -> None:
    kit.box("floor", (4.0, 1.6, 0.2), (-0.1, 0, 0.35), "soot")
    kit.box("cargo0", (1.0, 1.0, 0.9), (-1.3, -0.1, 0.8), "cargo_blue", dent_by=0.02)
    kit.box("cargo1", (0.9, 0.8, 0.8), (-0.3, 0.2, 0.85), "cargo_orange", rot=(0, 0, math.radians(15)), dent_by=0.02)
    kit.box("cargo2", (0.8, 0.8, 0.7), (-0.8, 0.0, 1.5), "cargo_pale", rot=(0, 0, math.radians(-25)), dent_by=0.02)
    # Spilled out of the open end.
    kit.box("spill0", (0.9, 0.9, 0.8), (1.9, -0.5, 0.4), "cargo_orange", rot=(0, 0, math.radians(35)), dent_by=0.02)
    kit.box("spill1", (0.8, 0.6, 0.6), (2.3, 0.7, 0.35), "cargo_blue", rot=(math.radians(14), 0, math.radians(-20)), dent_by=0.02)
    kit.box("spill2", (0.5, 0.5, 0.4), (1.1, 1.0, 0.25), "cargo_pale", rot=(0, 0, math.radians(50)))


def build(kit: Kit) -> None:
    shell(kit)
    load(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("cargo_pod", args, view_size=8.0)


if __name__ == "__main__":
    main()
