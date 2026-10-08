"""Nose's timber platforms against the ship's flank (C5): two plank decks on posts with rails, and two stair flights,
one from the ground to the lower deck and one from it to the upper deck.

Built at its in-game size. The decks are 12 m long along Y and 5 m deep along X, the lower one at 4 m and the upper
one, over the -Y end, at 8 m, with rails 1 m high. The back (X = -2.5) stands against the hull, and the front faces
+X. The first flight runs up along the front, outside the lower deck, from Y = 0.5 to 5.5, between X = 2.6 and 3.8.
The second climbs on the lower deck from Y = 6 to 1.2. Origin at the ground center of the decks.
Run: blender --background --python tools/blender/hull_scaffold.py -- public/models/hull_scaffold.glb [tmp/hull_scaffold.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "timber": 0x6A4A2A,  # PAL.trunk
    "plank": 0x9A7A4A,  # PAL.crate
    "dark": 0x3A2418,  # PAL.rust.dark, braces
}
SEED = 29

HALF_X = 2.5
HALF_Y = 6.0
LOW = 4.0
HIGH = 8.0
HIGH_Y = (-HALF_Y, 1.0)  # the upper deck's Y span
RAIL = 1.0


def deck(kit: Kit, name: str, y0: float, y1: float, z: float) -> None:
    kit.box(name, (2 * HALF_X, y1 - y0, 0.25), (0, (y0 + y1) / 2, z - 0.12), "plank", dent_by=0.02)
    for x in (-HALF_X + 0.15, HALF_X - 0.15):
        kit.box(f"{name}_beam{x:.0f}", (0.3, y1 - y0, 0.35), (x, (y0 + y1) / 2, z - 0.4), "timber")


def posts(kit: Kit, name: str, y0: float, y1: float, z: float) -> None:
    count = max(1, round((y1 - y0) / 3))
    for i in range(count + 1):
        y = y0 + (y1 - y0) * i / count
        for x in (-HALF_X + 0.15, HALF_X - 0.15):
            kit.box(f"{name}_{i}_{x:.0f}", (0.3, 0.3, z), (x, y, z / 2), "timber")
        if i < count:
            strut(kit, f"{name}_brace{i}", (HALF_X - 0.15, y + 0.2, 0.3), (HALF_X - 0.15, y + (y1 - y0) / count - 0.2, z - 0.6), 0.15, "dark")


def rail(kit: Kit, name: str, a: tuple[float, float, float], b: tuple[float, float, float]) -> None:
    """A rail from a to b at deck level: a top bar RAIL over it and posts every 1.5 m."""
    length = math.dist(a, b)
    count = max(1, round(length / 1.5))
    for i in range(count + 1):
        t = i / count
        p = tuple(a[j] + (b[j] - a[j]) * t for j in range(3))
        kit.box(f"{name}_post{i}", (0.12, 0.12, RAIL), (p[0], p[1], p[2] + RAIL / 2), "timber")
    strut(kit, f"{name}_top", (a[0], a[1], a[2] + RAIL), (b[0], b[1], b[2] + RAIL), 0.1, "timber")


def stair(kit: Kit, name: str, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> None:
    """A flight from (y0, z0) up to (y1, z1) between x0 and x1, with stringers and a rail on the +X side."""
    steps = round((z1 - z0) / 0.4)
    for i in range(steps):
        t = (i + 0.5) / steps
        kit.box(f"{name}_step{i}", (x1 - x0, 0.35, 0.08), ((x0 + x1) / 2, y0 + (y1 - y0) * t, z0 + (z1 - z0) * (i + 1) / steps - 0.04), "plank")
    for x in (x0 + 0.06, x1 - 0.06):
        strut(kit, f"{name}_stringer{x:.1f}", (x, y0, z0), (x, y1, z1), 0.18, "timber")
    rail(kit, f"{name}_rail", (x1 - 0.06, y0, z0), (x1 - 0.06, y1, z1))
    if z0 > 0.1:
        return
    kit.box(f"{name}_post", (0.25, 0.25, z1), (x1 - 0.1, y1, z1 / 2), "timber")


def build(kit: Kit) -> None:
    posts(kit, "low_post", -HALF_Y + 0.15, HALF_Y - 0.15, LOW)
    deck(kit, "low_deck", -HALF_Y, HALF_Y, LOW)
    posts(kit, "high_post", HIGH_Y[0] + 0.15, HIGH_Y[1] - 0.15, HIGH)
    deck(kit, "high_deck", *HIGH_Y, HIGH)
    rail(kit, "low_front", (HALF_X - 0.1, -HALF_Y, LOW), (HALF_X - 0.1, 0.4, LOW))
    rail(kit, "low_end", (-HALF_X, HALF_Y - 0.1, LOW), (HALF_X, HALF_Y - 0.1, LOW))
    rail(kit, "high_front", (HALF_X - 0.1, HIGH_Y[0], HIGH), (HALF_X - 0.1, HIGH_Y[1], HIGH))
    rail(kit, "high_end", (-HALF_X, HIGH_Y[0] + 0.1, HIGH), (HALF_X, HIGH_Y[0] + 0.1, HIGH))
    stair(kit, "stair_low", HALF_X + 0.1, HALF_X + 1.3, 0.5, 5.5, 0.0, LOW)
    stair(kit, "stair_high", 1.0, 2.3, HALF_Y, HIGH_Y[1] + 0.2, LOW, HIGH)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("hull_scaffold", args, view_size=18)


if __name__ == "__main__":
    main()
