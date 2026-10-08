"""Caltrop dropper: an open hopper box full of spikes with a chute at the back, drawn for the caltrops utility.

Footprint is one cell, 0.484 m across by 0.65 m along. The hopper rim is 0.4 m above the deck. The chute slopes
from the back wall down to the deck edge at X = -0.31 m. Worn metal with a mustard rim on the front wall.
Run: blender --background --python tools/blender/util_caltrops.py -- public/models/util_caltrops.glb [tmp/util_caltrops.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from shapes import strut, taper  # noqa: E402
from util_common import run  # noqa: E402

SEED = 402
LEG_H = 0.1
WALL = 0.03
BOX_X = (-0.16, 0.3)  # back and front wall X
BOX_HALF_Y = 0.22
RIM = 0.4
FLOOR = LEG_H + 0.04


def build(kit: Kit) -> None:
    back, front = BOX_X
    mid = (back + front) / 2
    length = front - back
    for x in (back + 0.04, front - 0.04):
        for y in (-BOX_HALF_Y + 0.04, BOX_HALF_Y - 0.04):
            kit.box(f"leg{x}{y}", (0.05, 0.05, LEG_H), (x, y, LEG_H / 2), "metal_dark")
    kit.box("floor", (length, BOX_HALF_Y * 2, 0.04), (mid, 0, FLOOR - 0.02), "metal_dark")
    wall_h = RIM - LEG_H
    wall_z = LEG_H + wall_h / 2
    for y in (-BOX_HALF_Y + WALL / 2, BOX_HALF_Y - WALL / 2):
        kit.box(f"side{y}", (length, WALL, wall_h), (mid, y, wall_z), "metal", dent_by=0.008)
    kit.box("front", (WALL, BOX_HALF_Y * 2, wall_h), (front - WALL / 2, 0, wall_z), "metal", dent_by=0.008)
    kit.box("front_rim", (0.05, BOX_HALF_Y * 2 + 0.01, 0.05), (front - 0.02, 0, RIM), "mustard")
    # The back wall is a low gate, so the spikes spill onto the chute.
    kit.box("gate", (WALL, BOX_HALF_Y * 2, 0.12), (back + WALL / 2, 0, FLOOR + 0.06), "metal_light")
    kit.box("gate_hinge", (0.04, BOX_HALF_Y * 2, 0.03), (back + WALL / 2, 0, FLOOR + 0.13), "metal_dark")
    # A spike heap fills the hopper: little four-sided spikes standing on a dark mound.
    kit.box("heap", (length - 0.1, BOX_HALF_Y * 2 - 0.08, 0.14), (mid + 0.03, 0, FLOOR + 0.07), "rust_dark", dent_by=0.02)
    for i in range(14):
        x = kit.rng.uniform(back + 0.06, front - 0.06)
        y = kit.rng.uniform(-BOX_HALF_Y + 0.06, BOX_HALF_Y - 0.06)
        h = kit.rng.uniform(0.07, 0.11)
        lean = (kit.rng.uniform(-0.6, 0.6), kit.rng.uniform(-0.6, 0.6), kit.rng.uniform(0, math.pi))
        spike = kit.cylinder(f"spike{i}", 0.03, h, (x, y, FLOOR + 0.14 + h / 2 - 0.02), "metal_light", rot=lean, vertices=3)
        taper(spike, 0.05)
    # The chute runs from the gate down to the deck edge, with two side lips.
    top = (back, FLOOR + 0.02)
    bottom = (-0.295, 0.04)
    run_len = math.hypot(top[0] - bottom[0], top[1] - bottom[1])
    tilt = math.atan2(top[1] - bottom[1], top[0] - bottom[0])
    center = ((top[0] + bottom[0]) / 2, 0, (top[1] + bottom[1]) / 2)
    kit.box("chute", (run_len, 0.3, 0.025), center, "metal_light", rot=(0, -tilt, 0), dent_by=0.004)
    for y in (-0.15, 0.15):
        kit.box(f"chute_lip{y}", (run_len, 0.02, 0.05), (center[0], y, center[2] + 0.02), "metal", rot=(0, -tilt, 0))
    strut(kit, "chute_leg", (bottom[0] + 0.04, 0, 0.0), (bottom[0] + 0.04, 0, bottom[1]), 0.03, "metal_dark")


if __name__ == "__main__":
    run("util_caltrops", build, SEED, 1, 1, view=1.3)
