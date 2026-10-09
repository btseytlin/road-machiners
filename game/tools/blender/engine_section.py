"""Engine section: a fallen piece of the colony ship's engine, a loot spot of Glass Flats.

Footprint radius 2.8 m: a ribbed casing segment 4 m long (x) and 3.6 m across, lying half sunk in the sand. Its top and
+X access panels are torn off, so the pumps and lines inside show from the iso camera. It uses the rust and steel colors of
engine_nozzle.py and engine_frame.py.
Run: blender --background --python tools/blender/engine_section.py -- public/models/engine_section.glb [tmp/engine_section.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import arc_panel, strut  # noqa: E402

COLORS = {
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "plate": 0x8E887C,  # PAL.hull.grey
    "plate_dark": 0x6E6A62,  # PAL.hull.dark
    "streak": 0x7E5634,  # PAL.hull.rust
    "steel": 0xA8A8A0,
    "soot": 0x1E1A18,
}
SEED = 283

R = 1.8  # m, outer radius of the casing
CZ = 1.0  # m, axis height
X0, X1 = -2.0, 2.0
OPEN = math.radians(50)  # the casing is kept below this angle from the top; the top is torn off


def casing(kit: Kit) -> None:
    arc_panel(kit, "plate_back", X0, 0.0, OPEN, 2 * math.pi - OPEN, R, CZ, "plate", thick=0.25, segs=10, tear=0.2, dent_by=0.05)
    arc_panel(kit, "plate_front", 0.0, X1, math.radians(95), 2 * math.pi - math.radians(95), R, CZ, "plate_dark", thick=0.25, segs=8, tear=0.5, dent_by=0.05)
    # Heavy ribs round the casing, one flange at the back end.
    for i, x in enumerate((X0 + 0.25, -0.9, 0.5, X1 - 0.25)):
        a = OPEN if x < 0 else math.radians(95)
        arc_panel(kit, f"rib{i}", x - 0.2, x + 0.2, a, 2 * math.pi - a, R + 0.12, CZ, "rust" if i % 2 else "rust_side", thick=0.4, segs=10)
    arc_panel(kit, "streak", -1.6, -0.9, math.radians(80), math.radians(120), R + 0.04, CZ, "streak", thick=0.05)


def guts(kit: Kit) -> None:
    kit.box("bed", (3.0, 1.5, 0.2), (0, 0, 0.35), "plate_dark")
    # Two pumps, a manifold and lines between them.
    kit.cylinder("pump0", 0.45, 1.2, (-1.0, 0.0, 0.95), "steel", rot=(math.radians(90), 0, 0), vertices=8)
    kit.cylinder("pump1", 0.35, 1.0, (0.6, -0.1, 0.8), "rust_dark", rot=(0, math.radians(90), 0), vertices=8)
    kit.box("manifold", (0.7, 0.6, 0.5), (0.0, 0.55, 0.65), "rust", dent_by=0.02)
    strut(kit, "line0", (-1.0, 0.5, 1.0), (0.0, 0.5, 1.1), 0.1, "steel")
    strut(kit, "line1", (0.0, 0.5, 0.9), (1.4, -0.6, 0.6), 0.1, "rust_dark")
    strut(kit, "line2", (-1.0, -0.6, 1.3), (0.5, -0.3, 1.9), 0.09, "steel")
    # A torn access panel fallen in front of the open end.
    kit.box("panel", (1.3, 1.0, 0.12), (1.9, 0.4, 0.2), "plate", rot=(math.radians(10), math.radians(-8), math.radians(30)), dent_by=0.04)


def build(kit: Kit) -> None:
    casing(kit)
    guts(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("engine_section", args, view_size=8.0)


if __name__ == "__main__":
    main()
