"""Curved sandbag wall with a steel hedgehog, the army's barricade.

Built to a 3.5 m reference radius: a wall arc about 5 m long and 1.1 m tall.
Run: blender --background --python tools/blender/sandbags.py -- public/models/sandbags.glb [tmp/sandbags.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "bag": 0x7C7442,  # PAL.scrub[2]
    "bag_dark": 0x5E6038,  # PAL.nose.top, olive drab
    "steel": 0x5E3420,  # PAL.rust.side
}
SEED = 59
ARC = 2.4  # radians of wall
ARC_RADIUS = 2.2  # m


def build(kit: Kit) -> None:
    # Three courses of bags along an arc, each course offset by half a bag.
    for course in range(3):
        count = 9 - course
        for i in range(count):
            a = (i - (count - 1) / 2) * (ARC / 9)
            mat = "bag" if (i + course) % 2 == 0 else "bag_dark"
            kit.box(f"bag{course}_{i}", (0.9, 0.55, 0.34), (ARC_RADIUS * math.cos(a) - 1.0, ARC_RADIUS * math.sin(a), 0.17 + course * 0.34), mat, rot=(0, 0, a), dent_by=0.03)
    # A hedgehog of three crossed girders beside the wall.
    for k, rot in enumerate(((0, 0, 0), (0, math.radians(90), 0), (0, 0, math.radians(90)))):
        kit.box(f"girder{k}", (1.6, 0.12, 0.12), (0.3, -0.2, 0.7), "steel", rot=(rot[0], rot[1], rot[2] + 0.4 * k))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("sandbags", args, view_size=8)


if __name__ == "__main__":
    main()
