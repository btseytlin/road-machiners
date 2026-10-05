"""The Fallen Sun's nose (C5): the blunt, faceted, tapered bow of the colony ship that the town of Nose is built
around. Large pale plates, a dark band of lit cockpit panes, a windshield, a long side window strip on the camera
side, a raised ring frame at the joint and a radar pedestal on top.

Built at its in-game size on the shared hull profile (ship_hull_kit.py): 36 m across at its rear joint, 56 m long.
The origin is the hull axis at the joint with the next section, and the axis runs +X to the blunt tip 56 m away. The
hull narrows on an ogive to a 6 m tip radius. socket_dish is the radar_dish spin axis on the pedestal, 30 m along.
Run: blender --background --python tools/blender/ship_nose.py -- public/models/ship_nose.glb [tmp/ship_nose.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from ship_hull_kit import (  # noqa: E402
    AXIS_Z,
    COLORS,
    RADIUS,
    SIDES,
    cap,
    core,
    corner,
    frame,
    plating,
    slab,
    stations,
)

SEED = 23
LENGTH = 56.0
TIP_RADIUS = 6.0
# Cockpit: a band of panes on the upper sides, and a windshield over the top, as x ranges in meters.
COCKPIT = (36.0, 46.0)
WINDSHIELD = (46.5, 52.0)
SIDE_STRIP = (14.0, 32.0)  # C5's long window row, on the side that faces the camera
PANE = 2.0  # pane length along the hull
LIT_SHARE = 0.3
DISH_AT = 30.0
PEDESTAL = 3.0  # the pedestal's side and its height over the top plates


def profile(x: float) -> tuple[float, float]:
    """(radius, axis height) at x along the nose."""
    t = min(1.0, max(0.0, x / LENGTH))
    return max(TIP_RADIUS, RADIUS * math.sqrt(max(0.0, 1 - t**2.4))), AXIS_Z


def at(x: float) -> tuple[float, float, float]:
    r, z = profile(x)
    return (x, r, z)


def panes(kit: Kit, name: str, x0: float, x1: float, faces: list[int]) -> None:
    """Dark panes proud of the plates on the given faces, a share of them lit."""
    count = max(1, round((x1 - x0) / PANE))
    for k in faces:
        for i in range(count):
            a, b = x0 + (x1 - x0) * i / count, x0 + (x1 - x0) * (i + 1) / count
            lit = kit.rng.random() < LIT_SHARE
            slab(kit, f"{name}_{k}_{i}", at(a), at(b), corner(k) + 0.06, corner(k + 1) - 0.06, "glow" if lit else "core", lift=0.2, thick=0.4, seam=0.25)


def build(kit: Kit) -> None:
    rings = stations(0.0, LENGTH, profile)
    plating(kit, "plate", rings)
    core(kit, "core", rings)
    # The blunt tip: a faceted plated cap over the last ring.
    cap(kit, "tip", rings[-1], 2.4, 0.55)
    frame(kit, "frame", 1.0)
    # Faces 0-1 are the +Y upper side and 3-4 the -Y upper side, 2 the top, 11 and 5 the sides.
    panes(kit, "cockpit", *COCKPIT, [0, 1, 3, 4])
    panes(kit, "windshield", *WINDSHIELD, [1, 2, 3])
    panes(kit, "strip", *SIDE_STRIP, [11, 5])
    # A pedestal on the top plates carries the radar dish.
    r, z = profile(DISH_AT)
    top = z + r * math.cos(math.pi / SIDES) + 0.1
    kit.box("pedestal", (PEDESTAL, PEDESTAL, PEDESTAL + 1.0), (DISH_AT, 0, top + PEDESTAL / 2 - 0.5), "steel", dent_by=0.04)
    kit.box("pedestal_cap", (PEDESTAL + 0.8, PEDESTAL + 0.8, 0.4), (DISH_AT, 0, top + PEDESTAL - 0.2), "frame")
    kit.socket("dish", (DISH_AT, 0, top + PEDESTAL))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_nose", args, view_size=90)


if __name__ == "__main__":
    main()
