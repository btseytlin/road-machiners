"""The crag of Nose (C5): a tall faceted cliff mass at the back right of the ring, that the torn stern of the colony
ship runs into. It rises to about 44 m, twice the 22 m ship-metal towers, so it stands above the back-right wall.

Stands in the site frame of nose_rock_kit.py: the origin is the site center at ground level, +X along the ship toward
its nose, +Y toward the south gate. Its footprint is the part of the ring behind a diagonal front edge that runs from
60 m back at x = -48 to 22 m back at x = -85 and then straight on, past x = -48 toward the stern and inside 120 m of
the center. Its front is a steep cliff, and its top is a broken plateau.
Run: blender --background --python tools/blender/nose_crag.py -- public/models/nose_crag.glb [tmp/nose_crag.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from nose_rock_kit import COLORS, heightfield  # noqa: E402

SEED = 62
EDGE_X = -48.0  # the crag's near end, toward the nose
TOP = 44.0


def front(x: float) -> float:
    """Where the footprint begins, meters back: 60 at the near end, sloping to 22 at x = -85 and beyond."""
    t = min(1.0, max(0.0, (EDGE_X - x) / 37.0))
    return 60.0 + (22.0 - 60.0) * t


def in_crag(x: float, v: float) -> bool:
    return x <= EDGE_X + 6.0


def height(x: float, v: float) -> float:
    depth = v - front(x)
    near = min(1.0, max(0.0, (EDGE_X + 6.0 - x) / 10.0))
    climb = min(1.0, max(0.0, depth / 12.0)) ** 0.8
    return 10.0 + (TOP - 10.0) * climb * near


def jitter(x: float, v: float) -> float:
    return 5.0


def build(kit: Kit) -> None:
    heightfield(kit, "crag", height, front, in_crag, jitter)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("nose_crag", args, view_size=260)


if __name__ == "__main__":
    main()
