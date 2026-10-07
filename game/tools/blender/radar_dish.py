"""Nose's radar dish (C5's moving part): a dish on a turning head, set on the ship nose's socket_dish pedestal.

Built at its in-game size. The origin is on the spin axis at the bottom of the head, and the whole model turns about
its vertical. The head is a 1.8 m drum 0.7 m tall, a yoke carries the dish 4.4 m up, and the 10 m dish faces +X,
tilted 25 degrees up, with its feed on three struts. It reaches about 5 m from the axis and 9 m up.
Run: blender --background --python tools/blender/radar_dish.py -- public/models/radar_dish.glb [tmp/radar_dish.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Euler, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut, taper  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "dish": 0xB8B8B0,  # FACTION_COLORS.convoys.top, the hull plates' pale
    "back": 0x86867E,  # FACTION_COLORS.convoys.side
    "steel": 0x5A5A58,  # PAL.metal
    "frame": 0x5E3420,  # PAL.rust.side
    "glow": 0xFFF2C8,  # PAL.lamp.on, the beacon
}
SEED = 27

HEAD = (0.9, 0.7)  # radius, height
PIVOT = Vector((0.4, 0.0, 4.4))  # the dish's tilt axis
DISH_R = 5.0
DISH_DEPTH = 1.5
TILT = math.radians(25)
FEED = 3.6  # meters from the dish center out to the feed


def build(kit: Kit) -> None:
    kit.cylinder("head", HEAD[0], HEAD[1], (0, 0, HEAD[1] / 2), "steel", vertices=10)
    kit.box("plinth", (1.4, 2.0, 0.5), (0, 0, HEAD[1] + 0.25), "frame")
    for side in (-1, 1):
        strut(kit, f"yoke{side}", (0, side * 0.8, HEAD[1] + 0.4), (PIVOT.x, side * 0.8, PIVOT.z), 0.3, "steel")
    kit.box("axle", (0.3, 1.9, 0.3), tuple(PIVOT), "steel")
    # The dish: a shallow cone opening toward +X, turned up by TILT about the pivot.
    look = Vector((math.cos(TILT), 0, math.sin(TILT)))
    center = PIVOT + look * 0.5
    rot = Euler((0, math.pi / 2 - TILT, 0))
    dish = kit.cylinder("dish", DISH_R, DISH_DEPTH, tuple(center + look * DISH_DEPTH / 2), "dish", rot=tuple(rot), vertices=14)
    taper(dish, 1.0, 0.18)
    kit.cylinder("dish_back", 1.0, 0.6, tuple(center - look * 0.2), "back", rot=tuple(rot), vertices=8)
    feed = center + look * FEED
    side = Vector((0, 1, 0))
    up = look.cross(side).normalized()
    for k in range(3):
        a = k * 2 * math.pi / 3
        rim = center + look * DISH_DEPTH + (side * math.cos(a) + up * math.sin(a)) * (DISH_R * 0.85)
        strut(kit, f"feed_strut{k}", tuple(rim), tuple(feed), 0.12, "steel")
    kit.box("feed", (0.5, 0.5, 0.5), tuple(feed), "steel")
    kit.box("beacon", (0.3, 0.3, 0.3), (-0.5, 0, HEAD[1] + 0.65), "glow")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("radar_dish", args, view_size=10)


if __name__ == "__main__":
    main()
