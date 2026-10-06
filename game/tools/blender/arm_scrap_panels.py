"""Scrap panel patchwork for the 'scrapPanels' armor.

A front-edge row of 2 cells: 0.97 m across, 0.65 m deep, outer face at +X. Mismatched rusty sheets and an old
road sign are bolted over two posts on the outer edge, about 0.9 m tall, on a foot with short gussets behind. One sheet takes the faction paint.
Run: blender --background --python tools/blender/arm_scrap_panels.py -- public/models/arm_scrap_panels.glb [tmp/arm_scrap_panels.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_armor import OUTER_X, half_span, rivets, run  # noqa: E402
from shapes import strut  # noqa: E402

N = 2
SEED = 34
BASE_X = OUTER_X - 0.1

# Sheets as (y center, z center, width, height, material, roll in degrees), back to front.
SHEETS = [
    (-0.19, 0.3, 0.36, 0.56, "rust_side", 2),
    (0.185, 0.28, 0.36, 0.52, "rust", -3),
    (-0.16, 0.68, 0.42, 0.42, "paint", -4),
    (0.18, 0.7, 0.36, 0.38, "rust_dark", 5),
    (0.02, 0.46, 0.3, 0.3, "rust", 8),
]


def build(kit: Kit) -> None:
    half = half_span(N)
    for y in (-half + 0.08, half - 0.08):
        kit.box(f"post{y:.2f}", (0.05, 0.05, 0.9), (BASE_X - 0.04, y, 0.45), "metal")
        strut(kit, f"gusset{y:.2f}", (BASE_X - 0.06, y, 0.3), (BASE_X - 0.17, y, 0.05), 0.04, "metal")
    kit.box("rail", (0.05, half * 2 - 0.02, 0.05), (BASE_X - 0.04, 0, 0.8), "rust_dark")
    kit.box("foot", (0.18, half * 2 - 0.02, 0.05), (BASE_X - 0.13, 0, 0.025), "rust_dark")
    for i, (y, z, w, h, mat, roll) in enumerate(SHEETS):
        x = BASE_X + 0.012 * i
        kit.box(f"sheet{i}", (0.02, w, h), (x, y, z), mat, rot=(math.radians(roll), 0, 0), dent_by=0.012)
    sign_x = BASE_X + 0.075
    kit.box("sign", (0.02, 0.26, 0.2), (sign_x, 0.18, 0.44), "sign", rot=(math.radians(-10), 0, 0))
    kit.box("sign_stripe", (0.01, 0.2, 0.05), (sign_x + 0.015, 0.18, 0.44), "sign_red", rot=(math.radians(-10), 0, 0))
    rivets(kit, "rivet_a", BASE_X + 0.05, [-0.34, -0.05, 0.1, 0.34], 0.12, "metal")
    rivets(kit, "rivet_b", BASE_X + 0.06, [-0.3, -0.02, 0.33], 0.82, "metal")


if __name__ == "__main__":
    run("arm_scrap_panels", build, SEED, N)
