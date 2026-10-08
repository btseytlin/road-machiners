"""Glass Flats ruin compound: a roofless New World yard of pale block walls with a two-room block, a red tarp and crates.

Reference radius 9.8 m, half the diagonal of its 16 x 11 m walls, built at its real size and drawn at scale 1. The walls
run from x -8 to 8 and y -5.5 to 5.5. The two-room block stands at the +x, -y corner, 7 x 6 m with 4.4 m walls, a door
on its +x face and window holes on every face. The yard behind it has 3.0 m walls, broken at a gate gap on the -y side
and at a breach in the -x wall. Timber posts stand 1.8 m above the block's corners and a scaffold frame rises over the
+y wall. A red tarp awning on four poles covers the middle of the yard at 3.6 to 4.9 m. Crates stand in the yard and
one by the door. The door faces +x.
Sizes are measured from docs/concepts/glass-flats-game-style-issue-112.jpg (tmp/models/ruin_compound/asset-brief.md).
Run: blender --background --python tools/blender/ruin_compound.py -- public/models/ruin_compound.glb [tmp/ruin_compound.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "block": 0xC4BAA6,  # PAL.hull.light, pale block
    "block_side": 0x8E887C,  # PAL.hull.grey
    "block_dark": 0x6E6A62,  # PAL.hull.dark, broken edges and rubble
    "timber": 0x6A4A2A,  # PAL.trunk
    "timber_dark": 0x3A2418,  # PAL.rust.dark
    "tarp": 0x8A3A2A,  # PAL.roof[2], red tarp
    "crate": 0x9A7A4A,  # PAL.crate
    "rust": 0x8A4A2A,  # PAL.rust.top
}
SEED = 114

HALF_X = 8.0  # m, half the compound's length
HALF_Y = 5.5  # m, half its width
BLOCK_X = 1.0  # m, the block's -x wall; it runs to HALF_X
BLOCK_Y = 0.5  # m, the block's +y wall; it runs from -HALF_Y
BLOCK_H = 4.4  # m, block wall height
YARD_H = 3.0  # m, yard wall height
THICK = 0.4  # m, wall thickness
SILL, HEAD = 2.0, 3.0  # m, window hole bottom and top

Hole = tuple[float, float, float, float]  # centre along the wall, width, bottom, top


def wall(kit: Kit, name: str, a: tuple[float, float], b: tuple[float, float], height: float, holes: list[Hole], mat: str, broken: float = 0.0) -> None:
    """A straight wall from a to b on the ground, built of solid pieces round its holes.

    Each hole is cut from its centre along the wall (meters from a), width, bottom and top. A hole with bottom 0 and
    top equal to height is a gap. broken lowers the top of each solid piece by up to that many meters, so tops read worn.
    """
    length = math.dist(a, b)
    yaw = math.atan2(b[1] - a[1], b[0] - a[0])

    def piece(tag: str, s0: float, s1: float, z0: float, z1: float, worn: bool) -> None:
        if s1 - s0 < 0.05 or z1 - z0 < 0.05:
            return
        top = z1 - (kit.rng.uniform(0, broken) if worn else 0)
        s = (s0 + s1) / 2
        x, y = a[0] + math.cos(yaw) * s, a[1] + math.sin(yaw) * s
        kit.box(f"{name}_{tag}", (s1 - s0, THICK, top - z0), (x, y, (z0 + top) / 2), mat, rot=(0, 0, yaw), dent_by=0.03)

    edges = [0.0]
    for i, (c, w, z0, z1) in enumerate(sorted(holes)):
        piece(f"p{i}", edges[-1], c - w / 2, 0.0, height, True)
        piece(f"under{i}", c - w / 2, c + w / 2, 0.0, z0, False)
        piece(f"over{i}", c - w / 2, c + w / 2, z1, height, True)
        edges.append(c + w / 2)
    piece("end", edges[-1], length, 0.0, height, True)


def block(kit: Kit) -> None:
    x0, x1, y0, y1 = BLOCK_X, HALF_X, -HALF_Y, BLOCK_Y
    wall(kit, "block_front", (x1, y0), (x1, y1), BLOCK_H, [(2.0, 1.3, 0.0, 2.3), (4.4, 1.0, SILL, HEAD)], "block", broken=0.3)
    wall(kit, "block_near", (x0, y0), (x1, y0), BLOCK_H, [(1.8, 1.0, SILL, HEAD), (5.0, 1.0, SILL, HEAD)], "block_side", broken=0.4)
    wall(kit, "block_back", (x0, y0), (x0, y1), BLOCK_H, [(3.5, 1.1, 0.0, 2.2)], "block", broken=0.5)
    wall(kit, "block_yard", (x0, y1), (x1, y1), BLOCK_H, [(1.8, 1.2, 0.0, 2.2), (4.8, 1.0, SILL, HEAD)], "block_side", broken=0.5)
    wall(kit, "block_split", (4.6, y0), (4.6, y1), BLOCK_H - 0.4, [(4.2, 1.0, 0.0, 2.1)], "block_side", broken=0.6)
    # Timber corner posts above the walls, with a crossbar on the front.
    for i, (x, y) in enumerate(((x1, y0), (x1, y1), (x0, y0))):
        kit.box(f"block_post{i}", (0.3, 0.3, BLOCK_H + 1.8), (x + 0.1, y, (BLOCK_H + 1.8) / 2), "timber", dent_by=0.02)
    strut(kit, "block_bar", (x1 + 0.1, y0, BLOCK_H + 1.3), (x1 + 0.1, y1, BLOCK_H + 1.3), 0.2, "timber_dark")
    strut(kit, "block_brace", (x1 + 0.1, y0, BLOCK_H), (x1 + 0.1, y0 + 2.2, BLOCK_H + 1.3), 0.15, "timber_dark")


def yard(kit: Kit) -> None:
    wall(kit, "yard_back", (-HALF_X, -HALF_Y), (-HALF_X, HALF_Y), YARD_H, [(7.2, 1.8, 0.0, YARD_H), (3.0, 0.9, 1.6, 2.4)], "block_side", broken=0.6)
    wall(kit, "yard_near", (-HALF_X, -HALF_Y), (BLOCK_X, -HALF_Y), YARD_H, [(5.0, 2.8, 0.0, YARD_H)], "block_side", broken=0.5)
    wall(kit, "yard_far", (-HALF_X, HALF_Y), (HALF_X, HALF_Y), YARD_H, [(4.0, 1.0, 1.5, 2.4), (11.0, 1.0, 1.5, 2.4)], "block", broken=0.5)
    wall(kit, "yard_front", (HALF_X, BLOCK_Y), (HALF_X, HALF_Y), YARD_H, [(2.6, 2.0, 0.0, YARD_H)], "block", broken=0.4)
    # Scaffold frame over the far wall: three posts with a bar and a diagonal.
    for i, x in enumerate((-6.5, -3.0, 0.5)):
        kit.box(f"scaffold_post{i}", (0.25, 0.25, 5.4), (x, HALF_Y - 0.4, 2.7), "timber", dent_by=0.02)
    strut(kit, "scaffold_bar", (-6.5, HALF_Y - 0.4, 5.0), (0.5, HALF_Y - 0.4, 5.0), 0.2, "timber_dark")
    strut(kit, "scaffold_diag", (-6.5, HALF_Y - 0.4, 3.0), (-3.0, HALF_Y - 0.4, 5.0), 0.15, "timber_dark")


def tarp(kit: Kit) -> None:
    # Four poles, the -x pair lower, so the awning slopes toward the back wall.
    for i, (x, y, h) in enumerate(((-5.5, -1.8, 3.6), (-0.5, -1.8, 4.2), (-5.5, 3.0, 3.6), (-0.5, 3.0, 4.2))):
        kit.box(f"tarp_pole{i}", (0.18, 0.18, h), (x, y, h / 2), "timber_dark")
    # The awning: a low peaked sheet tied to the pole tops, its peak 0.7 m over the high corners.
    corners = [(-5.7, -2.0, 3.6), (-0.3, -2.0, 4.2), (-0.3, 3.2, 4.2), (-5.7, 3.2, 3.6)]
    bm = bmesh.new()
    ring = [bm.verts.new(c) for c in corners]
    peak = bm.verts.new((-3.0, 0.6, 4.9))
    for i in range(4):
        bm.faces.new((ring[i], ring[(i + 1) % 4], peak))
    bm.faces.new(list(reversed(ring)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new("tarp")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("tarp", mesh)
    bpy.context.scene.collection.objects.link(obj)
    kit._add(obj, "tarp", "tarp", 0.05)
    kit.box("tarp_flap", (0.06, 5.2, 0.9), (0.0, 0.6, 3.75), "tarp", rot=(0, math.radians(-12), 0), dent_by=0.06)


def clutter(kit: Kit) -> None:
    for i, (x, y, z, s, yaw) in enumerate(((-6.6, -3.8, 0.6, 1.2, 0.1), (-6.4, -2.4, 0.6, 1.2, -0.2), (-6.5, -3.1, 1.75, 1.1, 0.3), (9.0, 2.5, 0.6, 1.2, 0.4))):
        kit.box(f"crate{i}", (s, s, 1.2 if z < 1 else 1.1), (x, y, z), "crate", rot=(0, 0, yaw), dent_by=0.03)
        kit.box(f"crate{i}_band", (s + 0.04, 0.12, 1.24 if z < 1 else 1.14), (x, y, z), "rust", rot=(0, 0, yaw))
    # Rubble blocks fallen from the broken tops.
    for i, (x, y) in enumerate(((-8.7, 1.8), (2.5, -6.2), (8.6, 4.9), (-4.0, 6.1))):
        kit.box(f"rubble{i}", (0.7, 0.5, 0.45), (x, y, 0.2), "block_dark", rot=(0, 0, kit.rng.uniform(0, 3)), dent_by=0.05)


def build(kit: Kit) -> None:
    block(kit)
    yard(kit)
    tarp(kit)
    clutter(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ruin_compound", args, view_size=22.0)


if __name__ == "__main__":
    main()
