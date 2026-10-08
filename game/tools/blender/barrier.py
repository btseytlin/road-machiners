"""Concrete jersey barrier, one segment of the barrier runs along the old orchard road.

Built to a 4 m segment, a 2 m reference radius like the fence: 3.9 m long along X, 1.0 m tall, 0.72 m wide at
the foot and 0.34 m at the top, chunkier than a real jersey barrier like the concept's. Segments laid every 4 m
leave a thin seam.
Run: blender --background --python tools/blender/barrier.py -- public/models/barrier.glb [tmp/barrier.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import prism  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "concrete": 0xB89A74,  # PAL.wall.top, the pale sun-bleached concrete of the concept
    "chip": 0x8E7454,  # PAL.wall.side
    "slot": 0x2A1A10,  # PAL.shadow
}
SEED = 61
LENGTH = 3.9  # m along X
# Jersey profile across the barrier (Blender Y, Z): a low kerb, a shallow slope, then a steep face to the top.
PROFILE = [(-0.36, 0.0), (0.36, 0.0), (0.36, 0.1), (0.23, 0.4), (0.17, 1.0), (-0.17, 1.0), (-0.23, 0.4), (-0.36, 0.1)]


def build(kit: Kit) -> None:
    # prism() extrudes an XZ profile along Y, so build the profile along Y and turn the segment onto X.
    body = prism(kit, "body", PROFILE, -LENGTH / 2, LENGTH / 2, "concrete")
    body.rotation_euler = (0, 0, math.radians(90))
    kit.dent(body, 0.015)
    # Two lifting slots through the foot, and a chipped top corner at one end, sunk into the top.
    for x in (-1.0, 1.0):
        kit.box(f"slot{x:+.0f}", (0.3, 0.74, 0.12), (x, 0, 0.16), "slot")
    kit.box("chip", (0.3, 0.36, 0.16), (1.8, 0, 0.9), "chip", dent_by=0.02)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("barrier", args, view_size=5)


if __name__ == "__main__":
    main()
