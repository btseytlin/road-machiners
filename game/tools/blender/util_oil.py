"""Oil spiller: a drum on its side in a cradle, with a valve spout at the back, drawn for the oilSpiller utility.

Footprint is one cell, 0.484 m across by 0.65 m along. The drum lies along X, 0.4 m across, its top 0.48 m above
the deck. The spout hangs from the back end down toward the deck. The drum is paint, so it takes the faction
color, and a mustard valve wheel marks the utility kind.
Run: blender --background --python tools/blender/util_oil.py -- public/models/util_oil.glb [tmp/util_oil.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_core import ALONG_X  # noqa: E402
from shapes import strut  # noqa: E402
from util_common import run  # noqa: E402

SEED = 403
DRUM_R = 0.2
DRUM_LEN = 0.5
DRUM_X = 0.05
DRUM_Z = 0.08 + DRUM_R
BACK = DRUM_X - DRUM_LEN / 2


def build(kit: Kit) -> None:
    # Two cradle saddles under the drum.
    for x in (DRUM_X - 0.16, DRUM_X + 0.16):
        kit.box(f"saddle{x}", (0.06, 0.44, 0.1), (x, 0, 0.05), "metal_dark")
        for y in (-0.16, 0.16):
            strut(kit, f"saddle_arm{x}{y}", (x, y * 1.3, 0.08), (x, y, 0.2), 0.04, "metal_dark")
    kit.cylinder("drum", DRUM_R, DRUM_LEN, (DRUM_X, 0, DRUM_Z), "paint", rot=ALONG_X, vertices=10, dent_by=0.008)
    for x in (DRUM_X - 0.12, DRUM_X + 0.12):
        kit.cylinder(f"rib{x}", DRUM_R + 0.012, 0.03, (x, 0, DRUM_Z), "metal", rot=ALONG_X, vertices=10)
    kit.cylinder("end_front", DRUM_R - 0.01, 0.02, (DRUM_X + DRUM_LEN / 2 + 0.005, 0, DRUM_Z), "metal", rot=ALONG_X, vertices=10)
    kit.cylinder("end_back", DRUM_R - 0.01, 0.02, (BACK - 0.005, 0, DRUM_Z), "metal", rot=ALONG_X, vertices=10)
    kit.cylinder("bung", 0.035, 0.04, (DRUM_X + 0.05, 0.07, DRUM_Z + DRUM_R), "metal_light", vertices=6)
    # The spout leaves the back end low, turns down, and ends in a sooty nozzle over the deck edge.
    spout_z = DRUM_Z - 0.1
    kit.cylinder("spout", 0.03, 0.06, (BACK - 0.04, 0, spout_z), "metal_light", rot=ALONG_X, vertices=6)
    strut(kit, "spout_down", (BACK - 0.06, 0, spout_z), (BACK - 0.06, 0, 0.06), 0.05, "metal_light", sides=6)
    kit.box("nozzle", (0.06, 0.12, 0.04), (BACK - 0.06, 0, 0.04), "soot")
    kit.cylinder("valve_stem", 0.012, 0.08, (BACK - 0.06, 0, spout_z + 0.06), "metal", vertices=4)
    kit.cylinder("valve", 0.06, 0.02, (BACK - 0.06, 0, spout_z + 0.1), "mustard", vertices=6)
    # A dark oil stain runs down the back end under the bung.
    kit.box("stain", (0.01, 0.1, 0.14), (BACK - 0.012, 0.05, DRUM_Z - 0.04), "soot")


if __name__ == "__main__":
    run("util_oil", build, SEED, 1, 1, view=1.3)
