"""Granary grain silo (C3): a pale cylinder with seams, hoops and rust streaks, a steep cone cap with a vent, standing
on a hopper and four braced steel legs over a concrete pad.

Built at its in-game size: shell radius 2.6 m, the hopper and legs to 4.5 m, the shell to 17 m, the cap to 19.6 m and
the vent to 20.1 m. The ladder climbs the +X side. The footprint stays within a 3.0 m radius. Origin at the ground
center.
Run: blender --background --python tools/blender/grain_silo.py -- public/models/grain_silo.glb [tmp/grain_silo.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import ladder, strut, taper, wall_patches  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "shell": 0xB8B8B0,  # FACTION_COLORS.convoys.top, C3's pale silos like the ring wall
    "seam": 0x86867E,  # FACTION_COLORS.convoys.side
    "metal": 0x5A5A58,  # PAL.metal
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "pad": 0x6E6254,  # PAL.rock.side
}
SEED = 83

RADIUS = 2.6
SIDES = 12
PAD = 0.3
BASE = 4.5  # top of the legs and hopper, where the shell starts
SHELL = 12.5
CAP = 2.6
LEG = 1.9  # half the square between the legs' centers
HOPPER_FOOT = 1.6  # where the hopper narrows to its spout


def build(kit: Kit) -> None:
    kit.cylinder("pad", RADIUS + 0.4, PAD, (0, 0, PAD / 2 - 0.05), "pad", vertices=SIDES, dent_by=0.03)
    corners = [(sx * LEG, sy * LEG) for sx in (-1, 1) for sy in (-1, 1)]
    for i, (x, y) in enumerate(corners):
        kit.box(f"leg{i}", (0.35, 0.35, BASE - PAD), (x, y, (BASE + PAD) / 2), "metal")
    # X braces on each side between the legs, and a ring beam under the shell.
    for i, ((x0, y0), (x1, y1)) in enumerate([(corners[0], corners[1]), (corners[1], corners[3]), (corners[3], corners[2]), (corners[2], corners[0])]):
        strut(kit, f"brace{i}a", (x0, y0, PAD + 0.2), (x1, y1, BASE - 0.4), 0.14, "rust_dark")
        strut(kit, f"brace{i}b", (x1, y1, PAD + 0.2), (x0, y0, BASE - 0.4), 0.14, "rust_dark")
    kit.cylinder("ring_beam", RADIUS + 0.1, 0.35, (0, 0, BASE - 0.1), "metal", vertices=SIDES)
    hopper = kit.cylinder("hopper", RADIUS, BASE - HOPPER_FOOT, (0, 0, (BASE + HOPPER_FOOT) / 2), "seam", vertices=SIDES, dent_by=0.03)
    taper(hopper, 1.0, 0.18)
    kit.cylinder("spout", 0.3, 0.9, (0, 0, HOPPER_FOOT - 0.4), "rust_dark", vertices=6)

    shell = kit.cylinder("shell", RADIUS, SHELL, (0, 0, BASE + SHELL / 2), "shell", vertices=SIDES, dent_by=0.03)
    for i in range(SIDES):
        a = 2 * math.pi * (i + 0.5) / SIDES
        r = RADIUS * math.cos(math.pi / SIDES)
        kit.box(f"seam{i}", (0.07, 0.1, SHELL), (r * math.cos(a), r * math.sin(a), BASE + SHELL / 2), "seam", rot=(0, 0, a))
    for i, z in enumerate((0.3, SHELL * 0.36, SHELL * 0.7, SHELL - 0.3)):
        kit.cylinder(f"hoop{i}", RADIUS + 0.05, 0.18, (0, 0, BASE + z), "metal", vertices=SIDES)
    wall_patches(kit, "streak", shell, 6, (0.9, 3.4), ["rust_side", "rust_side", "rust"])

    top = BASE + SHELL
    cap = kit.cylinder("cap", RADIUS + 0.15, CAP, (0, 0, top + CAP / 2), "shell", vertices=SIDES, dent_by=0.02)
    taper(cap, 0.1)
    kit.cylinder("vent", 0.3, 0.4, (0, 0, top + CAP + 0.1), "metal", vertices=6)
    kit.cylinder("vent_hat", 0.45, 0.1, (0, 0, top + CAP + 0.35), "rust_side", vertices=6)
    ladder(kit, "ladder", (RADIUS + 0.25, 0.0, BASE), top + 0.3, 0.5, 0.0, "rust_dark")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("grain_silo", args, view_size=10.0)


if __name__ == "__main__":
    main()
