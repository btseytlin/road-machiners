"""Patcher crane: a short jib on a turntable with a hook and a counterweight, drawn for the patcherCrane utility.

Footprint is one cell across by two along, 0.484 m by 1.3 m. The turntable sits at the back, the mast rises to
0.72 m, and the jib reaches forward to X = 0.54 m, where the hook hangs. The jib is mustard, like a work crane and the
utility kind. Base, mast and counterweight are worn metal.
Run: blender --background --python tools/blender/util_crane.py -- public/models/util_crane.glb [tmp/util_crane.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from shapes import strut, taper  # noqa: E402
from util_common import run  # noqa: E402

SEED = 404
TURN_X = -0.32
TURN_Z = 0.12
MAST_TOP = 0.72
JIB_TIP = (0.54, 0.0, 0.66)
HOOK_Z = 0.3


def build(kit: Kit) -> None:
    kit.box("base", (1.24, 0.44, 0.05), (0, 0, 0.025), "metal_dark")
    for y in (-0.17, 0.17):
        kit.box(f"rail{y}", (1.2, 0.05, 0.05), (0, y, 0.075), "metal")
    kit.cylinder("turntable", 0.2, 0.07, (TURN_X, 0, TURN_Z - 0.015), "metal", vertices=10)
    kit.cylinder("ring", 0.21, 0.025, (TURN_X, 0, TURN_Z + 0.03), "metal_light", vertices=10)
    kit.box("mast", (0.14, 0.14, MAST_TOP - TURN_Z), (TURN_X, 0, (MAST_TOP + TURN_Z) / 2 + 0.03), "metal", dent_by=0.005)
    kit.box("cab_box", (0.18, 0.18, 0.16), (TURN_X - 0.03, 0, TURN_Z + 0.12), "metal_dark", dent_by=0.006)
    kit.box("counterweight", (0.16, 0.3, 0.2), (TURN_X - 0.2, 0, TURN_Z + 0.16), "metal_dark", dent_by=0.008)
    kit.box("weight_stripe", (0.165, 0.305, 0.04), (TURN_X - 0.2, 0, TURN_Z + 0.2), "mustard")
    # The jib: a top chord and a sloped lower chord, laced with struts.
    top_root = (TURN_X, 0, MAST_TOP)
    low_root = (TURN_X + 0.04, 0, MAST_TOP - 0.22)
    for y in (-0.05, 0.05):
        strut(kit, f"jib_top{y}", (top_root[0], y, top_root[2]), (JIB_TIP[0], y, JIB_TIP[2]), 0.05, "mustard", dent_by=0.003)
        strut(kit, f"jib_low{y}", (low_root[0], y, low_root[2]), (JIB_TIP[0] - 0.04, y, JIB_TIP[2] - 0.03), 0.04, "mustard")
        for i in range(1, 4):
            t = i / 4
            x = TURN_X + (JIB_TIP[0] - TURN_X) * t
            z_top = MAST_TOP + (JIB_TIP[2] - MAST_TOP) * t
            z_low = low_root[2] + (JIB_TIP[2] - 0.03 - low_root[2]) * t
            strut(kit, f"lace{y}{i}", (x - 0.08, y, z_top), (x + 0.04, y, z_low), 0.025, "mustard")
    kit.box("jib_head", (0.08, 0.14, 0.1), (JIB_TIP[0], 0, JIB_TIP[2] - 0.02), "metal")
    kit.cylinder("sheave", 0.05, 0.12, (JIB_TIP[0] + 0.02, 0, JIB_TIP[2] - 0.06), "metal_light", rot=(1.5708, 0, 0), vertices=6)
    # The hoist line drops from the head to a hook block over the front of the deck.
    strut(kit, "line", (JIB_TIP[0] + 0.02, 0, JIB_TIP[2] - 0.08), (JIB_TIP[0] + 0.02, 0, HOOK_Z + 0.06), 0.015, "metal_dark", sides=4)
    kit.box("hook_block", (0.08, 0.06, 0.08), (JIB_TIP[0] + 0.02, 0, HOOK_Z + 0.03), "metal_dark")
    hook = kit.cylinder("hook", 0.035, 0.07, (JIB_TIP[0] + 0.02, 0, HOOK_Z - 0.04), "metal_light", vertices=4)
    taper(hook, 0.3)
    # A rest post holds the jib down while driving.
    strut(kit, "rest", (0.4, 0, 0.05), (0.4, 0, 0.52), 0.05, "metal")


if __name__ == "__main__":
    run("util_crane", build, SEED, 1, 2, view=1.8)
