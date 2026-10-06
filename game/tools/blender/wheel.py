"""Chunky off-road wheel for every truck.

Authored at 1 m radius and 1 m wide, with the axle along Blender Y and the origin at the hub center.
The view scales it by the chassis wheel radius and half-width. Chevron tread lugs show the wheel turning.
Each chevron is two half-bars mirrored across the mid-plane, so the top-down and front silhouettes
have matching halves and the wheel reads as one tire from every side (#201).
Run: blender --background --python tools/blender/wheel.py -- public/models/wheel.glb [tmp/wheel.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Euler, Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS  # noqa: E402

SEED = 102
AXLE = (math.radians(90), 0, 0)
LUGS = 12
TIRE_R = 0.935  # tire body radius. Lug tips reach 1 m.
LUG_H = 0.065
SWEEP = math.radians(28)  # each half-bar leans back from the centre line
BAR = (0.16, 0.3)  # half-bar size, tangential then axial
BAR_Y = 0.17  # half-bar center off the mid-plane

Lug = tuple[str, tuple[float, float, float], tuple[float, float, float]]


def lug_layout() -> list[Lug]:
    """Name, location and rotation of every half-bar. Blender Y is the axle."""
    out: list[Lug] = []
    r = TIRE_R + LUG_H / 2 - 0.02
    for i in range(LUGS):
        a = math.tau * i / LUGS
        radial = (math.cos(a), 0.0, math.sin(a))
        base = Euler((0, -a + math.pi / 2, 0)).to_matrix()
        for tag, side in (("l", -1), ("r", 1)):
            m = Matrix.Rotation(side * SWEEP, 3, radial) @ base
            out.append((f"lug{i}{tag}", (radial[0] * r, side * BAR_Y, radial[2] * r), tuple(m.to_euler())))
    return out


def check_mirrored(layout: list[Lug]) -> None:
    """Fails when a half-bar has no twin across the mid-plane, which would bring back the two-wheel look."""
    for name, loc, rot in layout:
        mirrored = next((l for l in layout if abs(l[1][0] - loc[0]) < 1e-6 and abs(l[1][2] - loc[2]) < 1e-6 and abs(l[1][1] + loc[1]) < 1e-6), None)
        if mirrored is None:
            raise ValueError(f"{name} has no mirrored twin across the mid-plane")
        a, b = Matrix(Euler(rot).to_matrix()), Matrix(Euler(mirrored[2]).to_matrix())
        flip = Matrix.Diagonal((1, -1, 1))
        if max(abs(x - y) for ra, rb in zip(a, flip @ b @ flip) for x, y in zip(ra, rb)) > 1e-5:
            raise ValueError(f"{name} is not the mirror of {mirrored[0]}")


def build(kit: Kit) -> None:
    kit.cylinder("tire", TIRE_R, 0.94, (0, 0, 0), "wheel", rot=AXLE, vertices=LUGS * 2)
    kit.cylinder("rim", 0.55, 0.98, (0, 0, 0), "metal_light", rot=AXLE, vertices=8)
    kit.cylinder("hub", 0.22, 1.0, (0, 0, 0), "rust", rot=AXLE, vertices=6)
    layout = lug_layout()
    check_mirrored(layout)
    for name, loc, rot in layout:
        kit.box(name, (BAR[0], BAR[1], LUG_H + 0.04), loc, "wheel", rot=rot)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("wheel", args, view_size=3.0)


if __name__ == "__main__":
    main()
