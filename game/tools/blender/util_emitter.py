"""Emitter: a finned power box carrying a coil mast and a dish, drawn for the emitter utility.

Footprint is two cells across by two along, 0.968 m by 1.3 m. The box top is 0.42 m above the deck. A copper-wound
coil rises from its back half to an electric blue tip (PAL.pulse.ring) at 1.0 m, and a shallow dish faces up and
forward beside it. Cooling fins line both sides. The box is worn metal with a mustard warning panel on its front.
Run: blender --background --python tools/blender/util_emitter.py -- public/models/util_emitter.glb [tmp/util_emitter.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_core import ALONG_X  # noqa: E402
from shapes import strut, taper  # noqa: E402
from util_common import run  # noqa: E402

SEED = 409
BOX = (1.0, 0.66, 0.34)
BOX_Z = 0.08 + BOX[2] / 2
BOX_TOP = 0.08 + BOX[2]
COIL = (-0.18, 0.12)  # coil mast X, Y
COIL_RINGS = 5
TIP_Z = 1.0
DISH = (0.22, -0.12)


def build(kit: Kit) -> None:
    for y in (-0.36, 0.36):
        kit.box(f"skid{y}", (1.24, 0.08, 0.08), (0, y, 0.04), "metal_dark")
    kit.box("box", BOX, (0, 0, BOX_Z), "metal", dent_by=0.008)
    kit.box("lid", (BOX[0] + 0.02, BOX[1] + 0.02, 0.04), (0, 0, BOX_TOP), "metal_dark")
    # Cooling fins stand out from both sides, past the box to the footprint edge.
    for side in (-1, 1):
        for i in range(6):
            x = -0.4 + i * 0.16
            kit.box(f"fin{side}{i}", (0.03, 0.12, BOX[2] - 0.08), (x, side * (BOX[1] / 2 + 0.06), BOX_Z), "metal_light")
    face = BOX[0] / 2
    kit.box("warning", (0.02, 0.4, 0.16), (face + 0.01, 0, BOX_Z + 0.03), "mustard")
    kit.box("warning_bolt", (0.025, 0.05, 0.12), (face + 0.02, 0, BOX_Z + 0.03), "soot", rot=(0.5, 0, 0))
    kit.box("vent", (0.02, 0.5, 0.05), (face + 0.01, 0, BOX_Z - 0.11), "metal_dark")
    # The coil: insulator foot, a wound column of copper rings, a cap and the bright tip.
    cx, cy = COIL
    kit.cylinder("coil_foot", 0.12, 0.08, (cx, cy, BOX_TOP + 0.06), "metal_dark", vertices=8)
    column_bottom = BOX_TOP + 0.1
    column_top = TIP_Z - 0.16
    kit.cylinder("coil_core", 0.05, column_top - column_bottom, (cx, cy, (column_top + column_bottom) / 2), "metal_dark", vertices=6)
    for i in range(COIL_RINGS):
        z = column_bottom + 0.04 + i * (column_top - column_bottom - 0.08) / (COIL_RINGS - 1)
        kit.cylinder(f"coil{i}", 0.1 - i * 0.008, 0.05, (cx, cy, z), "rust", vertices=8)
    cap = kit.cylinder("coil_cap", 0.09, 0.08, (cx, cy, column_top + 0.04), "metal_light", vertices=8)
    taper(cap, 0.5)
    tip = kit.cylinder("tip", 0.05, 0.08, (cx, cy, TIP_Z - 0.04), "spark", vertices=6)
    taper(tip, 0.2)
    # The dish leans up and forward on a short post.
    dx, dy = DISH
    strut(kit, "dish_post", (dx, dy, BOX_TOP), (dx, dy, BOX_TOP + 0.2), 0.05, "metal", sides=4)
    lean = math.radians(35)
    dish = kit.cylinder("dish", 0.2, 0.06, (dx + 0.02, dy, BOX_TOP + 0.24), "metal_light", rot=(0, lean, 0), vertices=10, dent_by=0.004)
    taper(dish, 1.0, 0.6)
    kit.cylinder("dish_horn", 0.025, 0.14, (dx + 0.08, dy, BOX_TOP + 0.33), "spark", rot=(0, lean, 0), vertices=4)
    # A heavy cable runs from the box's front to the coil foot.
    kit.cylinder("cable_out", 0.03, 0.1, (face - 0.1, cy, BOX_TOP + 0.02), "wheel", rot=ALONG_X, vertices=4)
    strut(kit, "cable", (face - 0.15, cy, BOX_TOP + 0.03), (cx + 0.1, cy, BOX_TOP + 0.06), 0.04, "wheel", sides=4)


if __name__ == "__main__":
    run("util_emitter", build, SEED, 2, 2, view=2.4)
