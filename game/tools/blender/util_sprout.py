"""Sprout smoke pot: a squat canister on a skid plate with a short soot-black chimney, drawn for the sprout utility.

Footprint is one cell, 0.484 m across by 0.65 m along. The canister top is 0.4 m above the deck and the chimney
top 0.62 m. Canister and chimney are worn metal, with a mustard band and valve wheel for the utility kind.
Run: blender --background --python tools/blender/util_sprout.py -- public/models/util_sprout.glb [tmp/util_sprout.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_core import ALONG_X  # noqa: E402
from shapes import strut, taper  # noqa: E402
from util_common import run  # noqa: E402

SEED = 401
PLATE_H = 0.04
CAN_R = 0.2
CAN_H = 0.36
CAN_X = 0.04
CAN_TOP = PLATE_H + CAN_H
CHIMNEY_X = -0.08


def build(kit: Kit) -> None:
    kit.box("plate", (0.6, 0.46, PLATE_H), (0, 0, PLATE_H / 2), "metal_dark", dent_by=0.004)
    kit.cylinder("can", CAN_R, CAN_H, (CAN_X, 0, PLATE_H + CAN_H / 2), "metal", vertices=8, dent_by=0.01)
    kit.cylinder("band", CAN_R + 0.012, 0.07, (CAN_X, 0, PLATE_H + CAN_H * 0.62), "mustard", vertices=8)
    lid = kit.cylinder("lid", CAN_R - 0.01, 0.06, (CAN_X, 0, CAN_TOP + 0.03), "metal_light", vertices=8)
    taper(lid, 0.75)
    # The chimney stands at the back of the lid, sooted at the mouth.
    kit.cylinder("chimney", 0.055, 0.2, (CHIMNEY_X, 0.04, CAN_TOP + 0.1), "metal_dark", vertices=6)
    kit.cylinder("chimney_mouth", 0.07, 0.04, (CHIMNEY_X, 0.04, CAN_TOP + 0.2), "soot", vertices=6)
    # A valve wheel on the front face lets the crew open the pot by hand.
    kit.cylinder("valve_stem", 0.02, 0.08, (CAN_X + CAN_R + 0.03, 0, PLATE_H + 0.12), "metal_light", rot=ALONG_X, vertices=4)
    kit.cylinder("valve", 0.06, 0.02, (CAN_X + CAN_R + 0.07, 0, PLATE_H + 0.12), "mustard", rot=ALONG_X, vertices=6)
    # Two strap bands hold the pot to the plate.
    for y in (-0.15, 0.15):
        strut(kit, f"strap{y}", (CAN_X - 0.18, y, PLATE_H), (CAN_X - 0.1, y, PLATE_H + 0.22), 0.025, "metal_dark")


if __name__ == "__main__":
    run("util_sprout", build, SEED, 1, 1, view=1.5)
