"""Fallen Sun hull chunk: a torn slab of the crashed colony ship, with ribs standing out of the sand.

Sized to a 6 m reference radius, so the slab is about 12 m long and 3.4 m tall at the high end.
Built of closed boxes and cylinders, so its collision shape can be read from it.
Run: blender --background --python tools/blender/hull_chunk.py -- public/models/hull_chunk.glb [tmp/hull_chunk.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts: the Fallen Sun's hull metal, as on the big pieces.
COLORS = {
    "metal": 0x8E887C,  # PAL.hull.grey
    "metal_light": 0xC4BAA6,  # PAL.hull.light
    "rust": 0x7E5634,  # PAL.hull.rust
    "rust_dark": 0x5E3420,  # PAL.rust.side
}
SEED = 41


def build(kit: Kit) -> None:
    # The skin: a long plate leaning on its torn edge, with a lower plate buckled against it.
    kit.box("skin", (11.0, 0.5, 3.2), (0, 0, 1.7), "metal", rot=(math.radians(14), 0, math.radians(3)), dent_by=0.08)
    kit.box("skin_low", (6.0, 0.5, 1.5), (-2.0, 1.6, 0.8), "metal_light", rot=(math.radians(-10), 0, math.radians(-8)), dent_by=0.08)
    # Ribs on the inner side, some snapped short.
    for k, h in enumerate((3.0, 2.2, 3.2, 1.4, 2.8)):
        x = -4.6 + k * 2.3
        kit.box(f"rib_{k}", (0.35, 0.5, h), (x, -0.6, h / 2), "rust", rot=(math.radians(14), 0, 0), dent_by=0.05)
    # A torn deck stub and a heap of fallen plating at the foot.
    kit.box("stub", (3.0, 2.4, 0.3), (3.2, -1.8, 0.45), "rust_dark", rot=(0, math.radians(6), math.radians(10)), dent_by=0.05)
    kit.box("heap", (2.2, 1.6, 0.7), (-4.2, -1.9, 0.35), "rust_dark", rot=(0, 0, math.radians(25)), dent_by=0.06)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("hull_chunk", args, view_size=16.0)


if __name__ == "__main__":
    main()
