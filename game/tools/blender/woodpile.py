"""A pile of lumber left on the old orchard farm: planks stacked in courses on bearers, and a few loose beams.

Built at its in-game size, drawn at scale 1: the stack is 3.6 m long along X, 1.6 m across and 1.2 m tall, and
the loose beams beside it make the pile about 4.5 x 2.7 m. Its footprint radius is 2.6 m, the reach of the loose
plank off the +X end. The planks run along X.
Run: blender --background --python tools/blender/woodpile.py -- public/models/woodpile.glb [tmp/woodpile.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "plank": 0x8E7454,  # PAL.wall.side, weathered boards
    "plank_dark": 0x6A5840,  # PAL.wall.dark
    "beam": 0x6A4A2A,  # PAL.trunk
    "sticker": 0x3A2418,  # PAL.rust.dark, the dark spacer battens and bearers
}
SEED = 101
LENGTH = 3.6  # m, a plank
PLANK = (0.3, 0.12)  # m, a plank's width and thickness
PER_COURSE = 5  # planks side by side
GAP = 0.025  # m between planks in a course
STICKER = 0.06  # m, a spacer batten's height
BEARER = 0.14  # m, the bearers under the stack
COURSES = 6


def build(kit: Kit) -> None:
    width = PER_COURSE * PLANK[0] + (PER_COURSE - 1) * GAP
    # Bearers on the ground, across the planks.
    for i, x in enumerate((-1.4, 0.0, 1.4)):
        kit.box(f"bearer{i}", (0.16, width + 0.2, BEARER), (x, 0, BEARER / 2), "sticker", dent_by=0.01)
    z = BEARER
    for c in range(COURSES):
        # The top course is half taken, so the stack reads ragged.
        count = PER_COURSE if c < COURSES - 1 else 3
        for i in range(count):
            y = -width / 2 + PLANK[0] / 2 + i * (PLANK[0] + GAP)
            shift = kit.rng.uniform(-0.12, 0.12)
            mat = "plank" if (i + c) % 3 else "plank_dark"
            kit.box(f"plank{c}_{i}", (LENGTH, PLANK[0], PLANK[1]), (shift, y, z + PLANK[1] / 2), mat, rot=(0, 0, kit.rng.uniform(-0.015, 0.015)), dent_by=0.01)
        z += PLANK[1]
        if c < COURSES - 1:
            # Spacer battens across the course, so air dries the next one.
            for i, x in enumerate((-1.4, 0.0, 1.4)):
                kit.box(f"sticker{c}_{i}", (0.06, width, STICKER), (x, 0, z + STICKER / 2), "sticker")
            z += STICKER
    # Loose beams: one leaning on the stack's side, one on the ground beside it, and two planks dropped in front.
    half = width / 2
    strut(kit, "beam_leaning", (-1.9, half + 0.4, 0.1), (1.6, half + 0.08, 0.95), 0.2, "beam", dent_by=0.01)
    kit.box("beam_ground", (3.4, 0.22, 0.22), (0.3, -half - 0.2, 0.11), "beam", rot=(0, 0, 0.04), dent_by=0.01)
    kit.box("plank_loose0", (2.2, 0.3, 0.05), (-0.7, -half - 0.3, 0.25), "beam", rot=(0.12, 0, -0.06), dent_by=0.01)
    kit.box("plank_loose1", (1.6, 0.3, 0.05), (1.75, -half - 0.1, 0.06), "plank_dark", rot=(0.05, 0, 0.5), dent_by=0.01)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("woodpile", args, view_size=6)


if __name__ == "__main__":
    main()
