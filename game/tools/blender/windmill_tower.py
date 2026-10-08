"""Bowl's farm windmill tower (C1): a tapered four-legged timber lattice with a head, a tail vane and a pump rod.

Built at its in-game size: the legs stand on a 3.2 m square and close to 0.9 m at the 10 m platform. The hub sits
at 10.5 m, 0.7 m in front (+X) of the tower axis, where socket_rotor marks the spin axis for windmill_rotor. The tail
vane reaches 2.8 m behind (-X). Origin at the ground center.
Run: blender --background --python tools/blender/windmill_tower.py -- public/models/windmill_tower.glb [tmp/windmill_tower.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import ladder, strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "timber": 0x6A4A2A,  # PAL.trunk
    "rust": 0x5E3420,  # PAL.rust.side, the braces
    "metal": 0x5A5A58,  # PAL.metal
    "vane": 0x8A4A2A,  # PAL.rust.top
    "plinth": 0x9A8A78,  # PAL.rock.top, the footings
}
SEED = 62

FOOT = 1.6  # half the leg square at the ground
HEAD = 0.45  # half the leg square at the platform
TOP = 10.0
HUB = (0.7, 0.0, 10.5)
LEVELS = (0.0, 3.0, 5.6, 7.9, TOP)
CORNERS = ((1, 1), (-1, 1), (-1, -1), (1, -1))


def leg_point(corner: tuple[int, int], z: float) -> tuple[float, float, float]:
    half = FOOT + (HEAD - FOOT) * z / TOP
    return (corner[0] * half, corner[1] * half, z)


def build(kit: Kit) -> None:
    for i, c in enumerate(CORNERS):
        kit.box(f"footing{i}", (0.6, 0.6, 0.5), (c[0] * FOOT, c[1] * FOOT, 0.05), "plinth")
        strut(kit, f"leg{i}", leg_point(c, -0.2), leg_point(c, TOP), 0.24, "timber", dent_by=0.01)
    for level, (z0, z1) in enumerate(zip(LEVELS, LEVELS[1:])):
        for i, (c0, c1) in enumerate(zip(CORNERS, CORNERS[1:] + CORNERS[:1])):
            if z0 > 0:
                strut(kit, f"ring{level}_{i}", leg_point(c0, z0), leg_point(c1, z0), 0.14, "timber")
            strut(kit, f"brace{level}_{i}a", leg_point(c0, z0 + 0.1), leg_point(c1, z1 - 0.1), 0.08, "rust")
            strut(kit, f"brace{level}_{i}b", leg_point(c1, z0 + 0.1), leg_point(c0, z1 - 0.1), 0.08, "rust")
    kit.box("platform", (1.5, 1.5, 0.12), (0, 0, TOP), "timber")
    ladder(kit, "ladder", (FOOT * 0.2, -FOOT - 0.1, 0.0), TOP, 0.45, 0.0, "metal")
    # The head: a gearbox on a short mast, the shaft to the hub, and the tail boom with its vane.
    kit.cylinder("mast", 0.18, 0.5, (0, 0, TOP + 0.25), "metal", vertices=8)
    kit.box("gearbox", (0.9, 0.5, 0.5), (0.1, 0, HUB[2]), "metal")
    strut(kit, "shaft", (0.5, 0, HUB[2]), (HUB[0] - 0.05, 0, HUB[2]), 0.14, "metal", sides=6)
    strut(kit, "boom", (-0.3, 0, HUB[2]), (-2.4, 0, HUB[2] + 0.3), 0.12, "metal")
    kit.box("vane", (1.3, 0.06, 1.0), (-2.3, 0, HUB[2] + 0.45), "vane", dent_by=0.02)
    strut(kit, "rod", (0.0, 0, 0.0), (0.0, 0, TOP), 0.06, "metal", sides=4)
    kit.socket("rotor", HUB)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("windmill_tower", args, view_size=14.0)


if __name__ == "__main__":
    main()
