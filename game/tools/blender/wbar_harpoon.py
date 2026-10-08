"""Launch tube and barbed bolt for the 'harpoon' weapon.

0.9 m long: a launch tube with a flared mouth, and the bolt's shaft and barbed head sticking out of it, with the rope
tied to the bolt's eye. Origin at the rear end, centered in Y and Z, running along +X.
Run: blender --background --python tools/blender/wbar_harpoon.py -- public/models/wbar_harpoon.glb [tmp/wbar_harpoon.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube  # noqa: E402
from shapes import strut, taper  # noqa: E402

SEED = 407
TUBE_END = 0.55
TIP_X = 0.9


def build(kit: Kit) -> None:
    tube(kit, "tube", 0.06, 0.0, TUBE_END, "metal", dent_by=0.003)
    tube(kit, "mouth", 0.075, TUBE_END - 0.06, TUBE_END, "dark")
    tube(kit, "shaft", 0.02, TUBE_END, TIP_X - 0.12, "metal_light", sides=4)
    point = tube(kit, "point", 0.055, TIP_X - 0.14, TIP_X, "metal_light", sides=4)
    taper(point, 0.05)
    for side in (-1, 1):
        kit.box(f"barb{side}", (0.12, 0.02, 0.03), (TIP_X - 0.16, side * 0.055, 0), "metal_light", rot=(0, 0, side * math.radians(-30)))
    kit.box("eye", (0.04, 0.03, 0.06), (TUBE_END + 0.05, 0, 0.04), "dark")
    strut(kit, "rope", (0.0, 0, 0.1), (TUBE_END + 0.05, 0, 0.07), 0.018, "rope", sides=4)
    kit.socket("tip", (TIP_X, 0, 0))


if __name__ == "__main__":
    run("wbar_harpoon", build, SEED, preview_m=1.2)
