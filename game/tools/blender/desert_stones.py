"""A few loose grey and tan stones from docs/concepts/wasteland-reference-issue-129.jpg, scattered on open desert
as decoration without collision.

Sized for a unit reference radius: the stones fit inside a 1 m footprint radius and stand about 0.45 m tall.
The game scales it uniformly, turns it at random and tints it.
Run: blender --background --python tools/blender/desert_stones.py -- public/models/desert_stones.glb [tmp/desert_stones.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import taper  # noqa: E402

COLORS = {
    "pebble": 0xB8AB9C,  # PAL.desertStone
    "pebble_pale": 0x8A847D,  # PAL.stoneGrey, a cool grey stone beside the tan ones
    "pebble_dark": 0xB47F5D,  # PAL.stone.side
}
SEED = 17


def build(kit: Kit) -> None:
    # One flat main stone, sunk a little so it reads as bedded in the sand.
    main = kit.cylinder("main", 0.55, 0.36, (0.0, 0.0, 0.12), "pebble", rot=(math.radians(6), 0, 0.4), vertices=6, dent_by=0.06)
    taper(main, 0.7)
    side = kit.cylinder("side", 0.3, 0.24, (0.55, 0.45, 0.08), "pebble_pale", rot=(0, math.radians(-10), 1.2), vertices=5, dent_by=0.04)
    taper(side, 0.6)
    chip = kit.cylinder("chip", 0.2, 0.14, (-0.6, 0.5, 0.05), "pebble_dark", rot=(math.radians(12), 0, 0.3), vertices=5, dent_by=0.03)
    taper(chip, 0.55)
    grit = kit.cylinder("grit", 0.14, 0.1, (0.3, -0.7, 0.04), "pebble", rot=(0, 0, 0.9), vertices=4, dent_by=0.02)
    taper(grit, 0.5)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("desert_stones", args, view_size=2.6)


if __name__ == "__main__":
    main()
