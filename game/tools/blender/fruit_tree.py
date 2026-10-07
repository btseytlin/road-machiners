"""Bowl's orchard tree (C1): a short trunk under a round crown of three faceted leaf lumps.

Built at its in-game size, drawn at scale 1: the crown is about 3.6 m across and tops out at 5.0 m, and the trunk
forks into it at 1.5 m. It stands inside a 1.9 m radius. Origin at the foot of the trunk.
Run: blender --background --python tools/blender/fruit_tree.py -- public/models/fruit_tree.glb [tmp/fruit_tree.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import taper  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "leaf": 0x5A7A3A,  # FACTION_COLORS.bowl.top, field green
    "leaf_dark": 0x4A6A2A,  # PAL.palm
    "trunk": 0x6A4A2A,  # PAL.trunk
}
SEED = 65

# Leaf lumps as (x, y, z, radius, material): one big crown and two side lumps, like C1's clustered crowns.
LUMPS = (
    (0.0, 0.0, 3.3, 1.55, "leaf"),
    (0.65, 0.45, 2.7, 1.1, "leaf_dark"),
    (-0.6, -0.4, 2.8, 1.05, "leaf"),
)


def lump(kit: Kit, name: str, at: tuple[float, float, float], radius: float, mat: str) -> None:
    """A faceted ball: a once-subdivided icosphere, dented so the facets catch light unevenly."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=at)
    kit._add(bpy.context.object, name, mat, radius * 0.08)


def build(kit: Kit) -> None:
    trunk = kit.cylinder("trunk", 0.22, 2.0, (0, 0, 1.0), "trunk", vertices=6, dent_by=0.02)
    taper(trunk, 0.7)
    for i, (x, y, z, r, mat) in enumerate(LUMPS):
        lump(kit, f"lump{i}", (x, y, z), r, mat)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("fruit_tree", args, view_size=7.0)


if __name__ == "__main__":
    main()
