"""The crag of Nose (C5): a tall faceted cliff mass at the back right of the ring, that the torn stern of the colony
ship runs into. It rises to about 44 m, twice the 22 m ship-metal towers, so it stands above the back-right wall.

Stands in the site frame of nose_rock_kit.py: the origin is the site center at ground level, +X along the ship toward
its nose, +Y toward the south gate. Its footprint is the part of the ring behind a diagonal front edge that runs from
60 m back at x = -90 to 22 m back at x = -127 and then straight on, past x = -90 toward the stern and inside 120 m of
the center, or out to the mountain's foot on its arc. Its front is a steep cliff, and its top is a broken plateau that
falls toward the foot outside the ring.
Run: blender --background --python tools/blender/nose_crag.py -- public/models/nose_crag.glb [tmp/nose_crag.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from nose_rock_kit import COLORS, heightfield, past_ring  # noqa: E402

SEED = 62
EDGE_X = -90.0  # the crag's near end, toward the nose, where the torn hull runs into it
TOP = 44.0
OUT_FALL = 0.7  # share of its height the crag loses from the ring to the mountain's foot


def front(x: float) -> float:
    """Where the footprint begins, meters back: 60 at the near end, sloping to 22 at x = -127 and beyond."""
    t = min(1.0, max(0.0, (EDGE_X - x) / 37.0))
    return 60.0 + (22.0 - 60.0) * t


def in_crag(x: float, v: float) -> bool:
    return x <= EDGE_X + 6.0


def height(x: float, v: float) -> float:
    depth = v - front(x)
    near = min(1.0, max(0.0, (EDGE_X + 6.0 - x) / 10.0))
    climb = min(1.0, max(0.0, depth / 12.0)) ** 0.8
    return (10.0 + (TOP - 10.0) * climb * near) * (1.0 - OUT_FALL * past_ring(x, -v))


def jitter(x: float, v: float) -> float:
    return 5.0


def build(kit: Kit) -> None:
    heightfield(kit, "crag", height, front, in_crag, jitter)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("nose_crag", args, view_size=440)


if __name__ == "__main__":
    main()
