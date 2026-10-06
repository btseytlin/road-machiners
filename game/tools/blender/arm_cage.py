"""Rebar cage for the 'cage' armor.

A front-edge row of 2 cells: 0.97 m across, 0.65 m deep, outer face at +X. A flat grille of rebar bars, 0.9 m tall,
stands STANDOFF past the outer edge on brackets, so it clears the body sides. A back rail joins the bracket clamps. The view leaves the bumper off its cells. The bar tips stick up unevenly past the top rail.
The top rail takes the faction paint.
Run: blender --background --python tools/blender/arm_cage.py -- public/models/arm_cage.glb [tmp/arm_cage.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_armor import OUTER_X, half_span, run, spread  # noqa: E402
from shapes import strut  # noqa: E402

N = 2
SEED = 32
HEIGHT = 0.9
RAIL_Z = 0.78
STANDOFF = 0.125
GRILLE_X = OUTER_X + STANDOFF
BRACKET_X = OUTER_X - 0.15
BARS = 7


def build(kit: Kit) -> None:
    edge = half_span(N) - 0.03
    for i, y in enumerate(spread(BARS, edge)):
        top = HEIGHT - kit.rng.uniform(0.0, 0.08)
        lean = kit.rng.uniform(-0.015, 0.015)
        strut(kit, f"bar{i}", (GRILLE_X + 0.02, y, 0.02), (GRILLE_X + 0.02, y + lean, top), 0.025, "rust", dent_by=0.003)
    kit.box("top_rail", (0.05, edge * 2, 0.05), (GRILLE_X, 0, RAIL_Z), "paint")
    kit.box("low_rail", (0.04, edge * 2, 0.04), (GRILLE_X, 0, 0.1), "metal", dent_by=0.003)
    for y in (-edge + 0.06, edge - 0.06):
        for z in (0.1, RAIL_Z):
            kit.box(f"bracket{y:.2f}_{z:.2f}", (GRILLE_X - BRACKET_X, 0.04, 0.04), ((GRILLE_X + BRACKET_X) / 2, y, z), "metal")
        kit.box(f"clamp{y:.2f}", (0.04, 0.08, RAIL_Z - 0.1 + 0.08), (BRACKET_X, y, (RAIL_Z + 0.1) / 2), "metal_light")
    kit.box("back_rail", (0.04, edge * 2, 0.04), (BRACKET_X, 0, RAIL_Z), "metal", dent_by=0.003)


if __name__ == "__main__":
    run("arm_cage", build, SEED, N, reach=GRILLE_X + 0.05)
