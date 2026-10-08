"""Glass Flats scrap wall: one loose, broken New World wall panel of pale block, propped up with timber.

Reference radius 3.8 m, half its 7.6 m length along x, built at its real size and drawn at scale 1. Three block slabs
stand in a row along x, 0.5 m thick, with worn tops from 3.6 m down to 2.4 m at the broken +x end. A rust sheet and a
rust stripe lie on the -y face with a timber post at each end, two timber props lean on the +y face, and rubble lies
at the foot.
Sizes are measured from docs/concepts/glass-flats-game-style-issue-112.jpg (tmp/models/scrap_wall/asset-brief.md).
Run: blender --background --python tools/blender/scrap_wall.py -- public/models/scrap_wall.glb [tmp/scrap_wall.png]
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
    "block": 0xC4BAA6,  # PAL.hull.light, pale block
    "block_side": 0x8E887C,  # PAL.hull.grey
    "block_dark": 0x6E6A62,  # PAL.hull.dark
    "rust": 0x8A4A2A,  # PAL.rust.top
    "timber": 0x6A4A2A,  # PAL.trunk
}
SEED = 117
HALF = 3.8  # m, half the wall's length
THICK = 0.5  # m

# Each slab's XZ outline: its x span and the heights of its broken top from -x to +x.
SLABS = (
    ((-3.8, -1.3), (3.5, 3.6, 3.5, 3.5)),
    ((-1.3, 1.3), (3.5, 3.3, 3.4, 3.2)),
    ((1.3, 3.8), (3.2, 3.0, 3.1, 2.4)),
)


def build(kit: Kit) -> None:
    for i, ((x0, x1), tops) in enumerate(SLABS):
        n = len(tops)
        top = [(x1 - (x1 - x0) * k / (n - 1) - (0.06 if k in (1, 2) else 0), tops[n - 1 - k]) for k in range(n)]
        profile = [(x0, 0.0), (x1, 0.0), *top]
        slab = prism(kit, f"slab{i}", profile, -THICK / 2, THICK / 2, "block" if i != 1 else "block_side")
        kit.dent(slab, 0.03)
    # Pilasters at the slab joints, a little proud of the faces.
    for i, x in enumerate((-1.3, 1.3)):
        kit.box(f"pilaster{i}", (0.4, THICK + 0.16, 3.0 - i * 0.4), (x, 0, (3.0 - i * 0.4) / 2), "block_dark", dent_by=0.03)
    # Timber posts at both ends on the -y face and a rust stripe along the foot.
    for i, x in enumerate((-HALF + 0.1, HALF - 0.4)):
        kit.box(f"end_post{i}", (0.25, 0.25, 3.9 - i * 1.0), (x, -THICK / 2 - 0.15, (3.9 - i * 1.0) / 2), "timber", rot=(0, math.radians(3 - 6 * i), 0))
    kit.box("stripe", (2 * HALF - 0.6, 0.06, 0.25), (0.0, -THICK / 2 - 0.04, 0.9), "rust", dent_by=0.02)
    kit.box("sheet", (2.0, 0.06, 1.6), (-2.2, -THICK / 2 - 0.05, 1.3), "rust", rot=(0, math.radians(4), 0), dent_by=0.05)
    for i, x in enumerate((-2.4, 2.0)):
        strut(kit, f"prop{i}", (x, THICK / 2 + 1.5, 0.0), (x + 0.2, THICK / 2 + 0.05, 2.4 - i * 0.3), 0.18, "timber")
    for i, (x, y) in enumerate(((3.1, -0.8), (3.9, 0.5), (-3.2, -0.9))):
        kit.box(f"rubble{i}", (0.8, 0.6, 0.5), (x, y, 0.2), "block_side", rot=(0, 0, kit.rng.uniform(0, 3)), dent_by=0.05)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("scrap_wall", args, view_size=10.0)


if __name__ == "__main__":
    main()
