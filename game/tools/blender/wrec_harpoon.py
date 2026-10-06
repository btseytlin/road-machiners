"""Harpoon launcher body for the 'harpoon' weapon.

About 0.75 m long: a short breech block on the pivot with a rope reel behind it, wound with pale rope (PAL.rope) that
runs forward over the breech to the bolt. Origin at the pivot. socket_muzzle at the front face center (0.2, 0, 0.16).
socket_extra on the top front edge (0.14, 0, 0.26).
Run: blender --background --python tools/blender/wrec_harpoon.py -- public/models/wrec_harpoon.glb [tmp/wrec_harpoon.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run, tube, yoke  # noqa: E402
from parts_common_core import ALONG_Y  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 406
MUZZLE = (0.2, 0.0, 0.16)
EXTRA = (0.14, 0.0, 0.26)
REEL_X = -0.36
REEL_Z = 0.2


def build(kit: Kit) -> None:
    yoke(kit, 0.24, 0.2)
    kit.box("breech", (0.4, 0.2, 0.18), (0.0, 0, MUZZLE[2]), "metal", dent_by=0.005)
    kit.box("breech_top", (0.3, 0.16, 0.04), (0.02, 0, 0.27), "paint", dent_by=0.004)
    tube(kit, "collar", 0.08, 0.16, MUZZLE[0], "dark", z=MUZZLE[2])
    kit.box("grip", (0.04, 0.04, 0.14), (-0.22, 0.0, 0.06), "dark")
    # The reel turns across the launcher on two arms that reach back from the breech.
    for y in (-0.13, 0.13):
        kit.box(f"reel_arm{y:.2f}", (0.26, 0.03, 0.04), (-0.27, y, REEL_Z), "metal")
        kit.cylinder(f"reel_side{y:.2f}", 0.15, 0.025, (REEL_X, y * 0.85, REEL_Z), "paint", rot=ALONG_Y, vertices=8)
    kit.cylinder("reel_rope", 0.12, 0.19, (REEL_X, 0, REEL_Z), "rope", rot=ALONG_Y, vertices=8, dent_by=0.006)
    kit.cylinder("reel_axle", 0.025, 0.3, (REEL_X, 0, REEL_Z), "dark", rot=ALONG_Y, vertices=6)
    # The rope leaves the top of the reel and runs forward over the breech.
    strut(kit, "rope", (REEL_X + 0.04, 0, REEL_Z + 0.12), (MUZZLE[0], 0, 0.3), 0.02, "rope", sides=4)
    kit.socket("muzzle", MUZZLE)
    kit.socket("extra", EXTRA)


if __name__ == "__main__":
    run("wrec_harpoon", build, SEED, preview_m=1.1)
