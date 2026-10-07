"""One patched scrap sheet for the 'scrapSheet' armor.

A front-edge row of 1 cell: 0.484 m across, 0.65 m deep, outer face at +X. Two rusty sheets overlap on two posts on
the outer edge, about 0.9 m tall, on a foot with short gussets behind. The upper sheet takes the faction paint.
Run: blender --background --python tools/blender/arm_scrap_sheet.py -- public/models/arm_scrap_sheet.glb [tmp/arm_scrap_sheet.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_armor import OUTER_X, half_span, rivets, run  # noqa: E402
from shapes import strut  # noqa: E402

N = 1
SEED = 40
BASE_X = OUTER_X - 0.1

# Sheets as (y center, z center, width, height, material, roll in degrees), back to front.
SHEETS = [
    (0.01, 0.3, 0.4, 0.56, "rust", -2),
    (-0.01, 0.68, 0.38, 0.4, "paint", 4),
    (0.08, 0.46, 0.2, 0.22, "rust_dark", -7),
]


def build(kit: Kit) -> None:
    half = half_span(N)
    for y in (-half + 0.06, half - 0.06):
        kit.box(f"post{y:.2f}", (0.05, 0.05, 0.9), (BASE_X - 0.04, y, 0.45), "metal")
        strut(kit, f"gusset{y:.2f}", (BASE_X - 0.06, y, 0.3), (BASE_X - 0.17, y, 0.05), 0.04, "metal")
    kit.box("rail", (0.05, half * 2 - 0.02, 0.05), (BASE_X - 0.04, 0, 0.8), "rust_dark")
    kit.box("foot", (0.18, half * 2 - 0.02, 0.05), (BASE_X - 0.13, 0, 0.025), "rust_dark")
    for i, (y, z, w, h, mat, roll) in enumerate(SHEETS):
        x = BASE_X + 0.012 * i
        kit.box(f"sheet{i}", (0.02, w, h), (x, y, z), mat, rot=(math.radians(roll), 0, 0), dent_by=0.012)
    rivets(kit, "rivet_a", BASE_X + 0.04, [-0.15, 0.15], 0.12, "metal")
    rivets(kit, "rivet_b", BASE_X + 0.05, [-0.14, 0.14], 0.82, "metal")


if __name__ == "__main__":
    run("arm_scrap_sheet", build, SEED, N)
