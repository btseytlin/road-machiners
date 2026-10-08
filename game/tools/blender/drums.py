"""A cluster of rusty 200-litre drums left by the old army farm: four standing, two of them on a pallet, and one
tipped over.

Built at its in-game size, drawn at scale 1: each drum is 0.58 m across and 0.88 m tall, and the cluster covers
about 2.7 x 2.3 m and stands 1.05 m tall. Its footprint radius is 1.75 m, the reach of the tipped drum and the loose
lid. The tipped drum lies toward +X.
Run: blender --background --python tools/blender/drums.py -- public/models/drums.glb [tmp/drums.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark, the rolling hoops
    "olive": 0x5E6038,  # PAL.nose.top, faded army paint
    "metal": 0x5A5A58,  # PAL.metal, bungs and the loose lid
    "pallet": 0x9A7A4A,  # PAL.crate
}
SEED = 97
RADIUS = 0.29  # m, a 200-litre drum
HEIGHT = 0.88  # m
HOOP = 0.02  # m, how far a rolling hoop stands out of the drum wall
PALLET = 0.15  # m, the pallet's height
SIDES = 10


def upright(kit: Kit, name: str, x: float, y: float, z: float, mat: str) -> None:
    """A standing drum on z with two rolling hoops and a bung on the lid."""
    kit.cylinder(name, RADIUS, HEIGHT, (x, y, z + HEIGHT / 2), mat, rot=(0, 0, kit.rng.uniform(0, math.pi)), vertices=SIDES, dent_by=0.015)
    for i, h in enumerate((HEIGHT / 3, HEIGHT * 2 / 3)):
        kit.cylinder(f"{name}_hoop{i}", RADIUS + HOOP, 0.04, (x, y, z + h), "rust_dark", vertices=SIDES)
    kit.cylinder(f"{name}_bung", 0.04, 0.03, (x + 0.15, y + 0.05, z + HEIGHT + 0.015), "metal", vertices=6)


def tipped(kit: Kit, name: str, x: float, y: float, yaw: float, mat: str) -> None:
    """A drum on its side, its axis turned `yaw` from +X, with its hoops."""
    rot = (0, math.pi / 2, yaw)
    axis = (math.cos(yaw), math.sin(yaw))
    kit.cylinder(name, RADIUS, HEIGHT, (x, y, RADIUS), mat, rot=rot, vertices=SIDES, dent_by=0.02)
    for i, t in enumerate((-HEIGHT / 6, HEIGHT / 6)):
        kit.cylinder(f"{name}_hoop{i}", RADIUS + HOOP, 0.04, (x + axis[0] * t, y + axis[1] * t, RADIUS), "rust_dark", rot=rot, vertices=SIDES)


def build(kit: Kit) -> None:
    # A low pallet under two of the drums.
    for i, dy in enumerate((-0.45, 0.0, 0.45)):
        kit.box(f"pallet_board{i}", (1.3, 0.3, 0.04), (-0.65, -0.55 + dy, PALLET - 0.02), "pallet", dent_by=0.01)
    for i, dx in enumerate((-0.55, 0.55)):
        kit.box(f"pallet_runner{i}", (0.1, 1.2, PALLET - 0.04), (-0.65 + dx, -0.55, (PALLET - 0.04) / 2), "pallet")
    upright(kit, "a", -0.95, -0.55, PALLET, "rust")
    upright(kit, "b", -0.33, -0.6, PALLET, "olive")
    # Two standing on the ground, and one tipped over and rolled away.
    upright(kit, "c", -0.7, 0.2, 0.0, "rust_side")
    upright(kit, "d", 0.05, -0.15, 0.0, "rust")
    tipped(kit, "e", 0.65, 0.65, 0.5, "olive")
    # The tipped drum's lid, lying on the ground.
    kit.cylinder("lid", RADIUS, 0.03, (1.1, -0.6, 0.015), "metal", vertices=SIDES, dent_by=0.01)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("drums", args, view_size=4)


if __name__ == "__main__":
    main()
