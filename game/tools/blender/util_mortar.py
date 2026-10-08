"""Smoke mortar: a short fat tube on a baseplate with a bipod, beside a crate of smoke rounds, for the smokeMortar utility.

Footprint is one cell across by two along, 0.484 m by 1.3 m. The tube stands near the middle, raised 60 degrees
toward the nose, its muzzle about 0.7 m above the deck. The round crate at the back is mustard for the utility kind.
Plate, tube and bipod are worn metal.
Run: blender --background --python tools/blender/util_mortar.py -- public/models/util_mortar.glb [tmp/util_mortar.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from shapes import strut  # noqa: E402
from util_common import run  # noqa: E402

SEED = 406
PLATE_X = 0.08
TUBE_R = 0.12
TUBE_LEN = 0.62
RAISE = math.radians(60)
BREECH = (-0.04, 0.0, 0.14)
CRATE_X = -0.44


def build(kit: Kit) -> None:
    kit.box("deck_plate", (1.24, 0.44, 0.04), (0, 0, 0.02), "metal_dark")
    kit.cylinder("baseplate", 0.22, 0.06, (PLATE_X - 0.08, 0, 0.07), "metal", vertices=8, dent_by=0.006)
    tilt = math.pi / 2 - RAISE
    axis = (math.sin(tilt), 0, math.cos(tilt))
    bx, by, bz = BREECH

    def along(d: float) -> tuple[float, float, float]:
        return (bx + axis[0] * d, by, bz + axis[2] * d)

    kit.cylinder("tube", TUBE_R, TUBE_LEN, along(TUBE_LEN / 2), "metal", rot=(0, tilt, 0), vertices=8, dent_by=0.006)
    kit.cylinder("muzzle_ring", TUBE_R + 0.02, 0.06, along(TUBE_LEN - 0.03), "metal_dark", rot=(0, tilt, 0), vertices=8)
    kit.cylinder("muzzle_soot", TUBE_R - 0.02, 0.02, along(TUBE_LEN), "soot", rot=(0, tilt, 0), vertices=8)
    kit.cylinder("breech_cap", TUBE_R + 0.03, 0.1, along(0.03), "metal_dark", rot=(0, tilt, 0), vertices=8)
    # The bipod clamps the tube halfway up and spreads its legs forward.
    clamp = along(TUBE_LEN * 0.55)
    kit.box("clamp", (0.08, 0.3, 0.06), clamp, "metal_dark", rot=(0, tilt, 0))
    for y in (-0.17, 0.17):
        strut(kit, f"leg{y}", (clamp[0], y * 0.8, clamp[2]), (clamp[0] + 0.12, y, 0.06), 0.035, "metal_light", sides=4)
        kit.box(f"foot{y}", (0.08, 0.06, 0.03), (clamp[0] + 0.12, y, 0.055), "metal_dark")
    # The round crate, its lid open a crack, with three finned round tails showing.
    kit.box("crate", (0.32, 0.4, 0.22), (CRATE_X, 0, 0.04 + 0.11), "mustard", dent_by=0.006)
    kit.box("crate_band", (0.325, 0.405, 0.04), (CRATE_X, 0, 0.12), "metal_dark")
    for i, y in enumerate((-0.11, 0.0, 0.11)):
        kit.cylinder(f"round{i}", 0.045, 0.1, (CRATE_X, y, 0.29), "metal_light", vertices=6)
        kit.box(f"fins{i}", (0.1, 0.02, 0.05), (CRATE_X, y, 0.33), "metal")


if __name__ == "__main__":
    run("util_mortar", build, SEED, 1, 2, view=1.8)
