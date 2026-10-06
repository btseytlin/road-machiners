"""Reinforced cage for the 'reinforcedCage' armor.

A front-edge row of 3 cells: 1.45 m across, 0.65 m deep, outer face at +X. A flat grille of heavy box-section bars,
0.9 m tall, with cross-bracing in every bay. It stands STANDOFF past the outer edge on brackets, so it clears the body
sides. A back rail joins the brackets. The view leaves the bumper off its cells.
The top rail and corner gussets take the faction paint.
Run: blender --background --python tools/blender/arm_reinforced_cage.py -- public/models/arm_reinforced_cage.glb [tmp/arm_reinforced_cage.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_armor import OUTER_X, half_span, run  # noqa: E402
from shapes import strut  # noqa: E402

N = 3
SEED = 37
HEIGHT = 0.9
BAR = 0.07
STANDOFF = 0.125
GRILLE_X = OUTER_X + STANDOFF
BRACKET_X = OUTER_X - 0.15


def build(kit: Kit) -> None:
    edge = half_span(N) - 0.045
    posts = (-edge, 0.0, edge)
    for y in posts:
        kit.box(f"post{y:.2f}", (BAR, BAR, HEIGHT), (GRILLE_X, y, HEIGHT / 2), "metal", dent_by=0.004)
        for z in (0.12, HEIGHT - 0.1):
            kit.box(f"bracket{y:.2f}_{z:.2f}", (GRILLE_X - BRACKET_X, 0.05, 0.05), ((GRILLE_X + BRACKET_X) / 2, y, z), "metal")
    kit.box("back_rail", (0.05, edge * 2 + 0.05, 0.05), (BRACKET_X, 0, HEIGHT - 0.1), "metal", dent_by=0.004)
    kit.box("low_rail", (BAR, edge * 2, BAR), (GRILLE_X, 0, 0.12), "metal")
    kit.box("top_rail", (BAR + 0.01, edge * 2 + BAR, BAR + 0.01), (GRILLE_X, 0, HEIGHT - BAR / 2), "paint")
    for y in (-edge, edge):
        kit.box(f"gusset{y:.2f}", (0.02, 0.16, 0.16), (GRILLE_X + BAR / 2 + 0.01, y - 0.06 * (y / edge), HEIGHT - 0.14), "paint")
    x = GRILLE_X + 0.02
    for a, b in ((-edge, 0.0), (0.0, edge)):
        strut(kit, f"x_{a:.2f}", (x, a, 0.15), (x, b, HEIGHT - 0.08), 0.045, "rust")
        strut(kit, f"x_{b:.2f}", (x, b, 0.15), (x, a, HEIGHT - 0.08), 0.045, "rust")


if __name__ == "__main__":
    run("arm_reinforced_cage", build, SEED, N, reach=GRILLE_X + 0.06)
