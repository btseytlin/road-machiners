"""Spaced armor for the 'spacedArmor' armor.

A front-edge row of 4 cells: 1.94 m across, 0.65 m deep, outer face at +X. An inner steel wall and an outer layer of
four panels stand 0.2 m apart on bolted standoffs, 0.9 m tall, on a foot with a short gusset behind each panel. The outer panels take the faction paint.
Run: blender --background --python tools/blender/arm_spaced.py -- public/models/arm_spaced.glb [tmp/arm_spaced.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_armor import CELL_ACROSS, OUTER_X, half_span, run  # noqa: E402
from shapes import strut  # noqa: E402

N = 4
SEED = 36
OUTER_PANEL_X = OUTER_X - 0.05
INNER_X = OUTER_PANEL_X - 0.2
HEIGHT = 0.9


def build(kit: Kit) -> None:
    half = half_span(N)
    kit.box("inner", (0.05, half * 2 - 0.02, HEIGHT - 0.06), (INNER_X, 0, (HEIGHT - 0.06) / 2), "metal", dent_by=0.005)
    kit.box("foot", (0.34, half * 2, 0.04), (INNER_X + 0.02, 0, 0.02), "dark")
    gap = OUTER_PANEL_X - INNER_X
    for c in range(N):
        y = -half + CELL_ACROSS * (c + 0.5)
        h = HEIGHT - kit.rng.uniform(0.0, 0.04)
        kit.box(f"panel{c}", (0.04, CELL_ACROSS - 0.03, h - 0.1), (OUTER_PANEL_X, y, 0.1 + (h - 0.1) / 2), "paint", dent_by=0.008)
        for z in (0.28, 0.72):
            kit.cylinder(f"standoff{c}_{z}", 0.03, gap, (INNER_X + gap / 2, y, z), "metal_light", rot=(0, math.radians(90), 0), vertices=6)
            kit.box(f"bolt{c}_{z}", (0.03, 0.05, 0.05), (OUTER_PANEL_X + 0.025, y, z), "dark")
        strut(kit, f"gusset{c}", (INNER_X - 0.03, y, 0.32), (INNER_X - 0.12, y, 0.04), 0.05, "metal")


if __name__ == "__main__":
    run("arm_spaced", build, SEED, N)
