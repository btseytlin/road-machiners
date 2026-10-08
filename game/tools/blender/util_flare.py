"""Flare cannon: a slim launch tube with a red tip on a pivot post, beside a rack of flare rounds, for the flareCannon utility.

Footprint is one cell, 0.484 m across by 0.65 m along. The tube is raised 40 degrees toward the nose, its red tip
0.66 m above the deck. Base, post and tube are worn metal. The pivot yoke is mustard for the utility kind, and the
flare rounds wear red caps.
Run: blender --background --python tools/blender/util_flare.py -- public/models/util_flare.glb [tmp/util_flare.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_core import ALONG_Y  # noqa: E402
from util_common import run  # noqa: E402

SEED = 407
PIVOT = (-0.1, 0.04, 0.34)
TUBE_LEN = 0.54
TUBE_R = 0.05
RAISE = math.radians(40)  # tube elevation above the deck


def build(kit: Kit) -> None:
    kit.box("base", (0.56, 0.42, 0.05), (0, 0, 0.025), "metal_dark")
    px, py, pz = PIVOT
    kit.box("post", (0.1, 0.1, pz - 0.05), (px, py, 0.05 + (pz - 0.05) / 2), "metal")
    kit.box("yoke", (0.08, 0.16, 0.08), (px, py, pz), "mustard")
    kit.cylinder("trunnion", 0.035, 0.2, (px, py, pz), "metal_light", rot=ALONG_Y, vertices=6)
    # The tube's axis is Kit Z turned toward +X, so it points up and forward from the pivot.
    tilt = math.pi / 2 - RAISE
    axis = (math.sin(tilt), 0, math.cos(tilt))
    offset = 0.12  # the tube's breech sits this far behind the pivot

    def along(d: float) -> tuple[float, float, float]:
        return (px + axis[0] * d, py, pz + axis[2] * d)

    kit.cylinder("tube", TUBE_R, TUBE_LEN, along(TUBE_LEN / 2 - offset), "metal", rot=(0, tilt, 0), vertices=8, dent_by=0.004)
    kit.cylinder("breech", TUBE_R + 0.02, 0.1, along(-offset + 0.05), "metal_dark", rot=(0, tilt, 0), vertices=8)
    kit.cylinder("tip", TUBE_R + 0.012, 0.07, along(TUBE_LEN - offset - 0.035), "flare", rot=(0, tilt, 0), vertices=8)
    # A rack of three flare rounds on the right of the base.
    for i, x in enumerate((-0.16, 0.0, 0.16)):
        kit.cylinder(f"round{i}", 0.035, 0.18, (x + 0.06, -0.14, 0.14), "metal_light", vertices=6)
        kit.cylinder(f"cap{i}", 0.038, 0.04, (x + 0.06, -0.14, 0.25), "red", vertices=6)
    kit.box("rack", (0.46, 0.1, 0.06), (0.06, -0.14, 0.08), "metal_dark")


if __name__ == "__main__":
    run("util_flare", build, SEED, 1, 1, view=1.4)
