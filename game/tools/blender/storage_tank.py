"""Dustwell's water storage tank (C2): a tall pale cylinder with vertical seams, hoops, a shallow cone roof with a hatch,
a side ladder and rust streaks.

Built at its in-game size: shell radius 2.6 m, 10.4 m tall on a 0.6 m ring plinth, the roof cone to 12.1 m and the
hatch to 12.4 m. The ladder climbs the +X side and the outlet stub points to -Y. The footprint stays within a 3.0 m
radius. Origin at the ground center. Dustwell's squat tank is the same model scaled down in height.
Run: blender --background --python tools/blender/storage_tank.py -- public/models/storage_tank.glb [tmp/storage_tank.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import ladder, taper, wall_patches  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "shell": 0x86867E,  # FACTION_COLORS.convoys.side, C2's pale weathered tank
    "seam": 0x5A5A58,  # PAL.metal
    "roof": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "plinth": 0x6E6254,  # PAL.rock.side
}
SEED = 73

RADIUS = 2.6
PLINTH = 0.6
SHELL = 10.4
ROOF = 1.1
SIDES = 12


def build(kit: Kit) -> None:
    kit.cylinder("plinth", RADIUS + 0.3, PLINTH, (0, 0, PLINTH / 2 - 0.1), "plinth", vertices=SIDES, dent_by=0.03)
    base = PLINTH - 0.1
    shell = kit.cylinder("shell", RADIUS, SHELL, (0, 0, base + SHELL / 2), "shell", vertices=SIDES, dent_by=0.03)
    for i in range(SIDES):
        a = 2 * math.pi * (i + 0.5) / SIDES
        r = RADIUS * math.cos(math.pi / SIDES)
        kit.box(f"seam{i}", (0.07, 0.1, SHELL), (r * math.cos(a), r * math.sin(a), base + SHELL / 2), "seam", rot=(0, 0, a))
    for i, z in enumerate((0.4, SHELL * 0.5, SHELL - 0.3)):
        kit.cylinder(f"hoop{i}", RADIUS + 0.05, 0.16, (0, 0, base + z), "rust_dark", vertices=SIDES)
    wall_patches(kit, "streak", shell, 5, (0.8, 3.0), ["rust", "rust_side"])
    top = base + SHELL
    roof = kit.cylinder("roof", RADIUS + 0.15, ROOF, (0, 0, top + ROOF / 2), "roof", vertices=SIDES, dent_by=0.02)
    taper(roof, 0.12)
    kit.cylinder("hatch", 0.4, 0.3, (0, 0, top + ROOF + 0.1), "seam", vertices=8)
    kit.box("vent", (0.3, 0.3, 0.5), (1.2, 0.6, top + 0.65), "rust_dark", rot=(0, 0.35, 0.5))
    ladder(kit, "ladder", (RADIUS + 0.25, 0.0, 0.2), top + 0.2, 0.5, 0.0, "rust_dark")
    kit.box("rail", (0.06, 1.4, 0.06), (RADIUS + 0.1, 0.0, top + 0.9), "rust_dark")
    kit.cylinder("outlet", 0.22, 0.6, (0, -RADIUS - 0.25, base + 0.6), "seam", rot=(math.pi / 2, 0, 0), vertices=6)
    kit.cylinder("outlet_valve", 0.3, 0.08, (0, -RADIUS - 0.45, base + 0.6), "rust", rot=(math.pi / 2, 0, 0), vertices=8)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("storage_tank", args, view_size=8.0)


if __name__ == "__main__":
    main()
