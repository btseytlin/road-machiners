"""Glass Flats glass spire: a cluster of faceted teal glass pyramids grown out of the fused sand.

Reference radius 5 m, half the cluster's 10 m length along x, built at its real size and drawn at scale 1. A big
eight-faced fluted pyramid 7.4 m across its ridges stands 7.5 m tall at x -1.5 with its apex a little off centre, a
smaller six-faced one 3.8 m across and 3.6 m tall stands at its +x foot, and a 1.6 m shard and a 1.2 m chip stand
beside them. Faces meet at sharp ridges, so flat shading gives each face its own light.
Sizes are measured from docs/concepts/glass-flats-game-style-issue-112.jpg (tmp/models/glass_spire/asset-brief.md).
Run: blender --background --python tools/blender/glass_spire.py -- public/models/glass_spire.glb [tmp/glass_spire.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "glass": 0x9CB8AC,  # PAL.glass.top
    "glass_side": 0x6F8F88,  # PAL.glass.side
    "glass_dark": 0x4C6460,  # PAL.glass.dark
}
SEED = 116
SINK = 0.2  # m, the base ring sits this far into the sand, so no gap shows on uneven ground


def pyramid(kit: Kit, name: str, at: tuple[float, float], radii: list[float], apex: Vec3, mat: str, turn: float = 0.0) -> None:
    """A pyramid over a ring of base corners at the given radii round `at`, evenly spaced from angle `turn`.

    apex is relative to `at`. The base is closed, so the mesh is solid.
    """
    bm = bmesh.new()
    n = len(radii)
    ring = [
        bm.verts.new((at[0] + math.cos(turn + i * math.tau / n) * r, at[1] + math.sin(turn + i * math.tau / n) * r, -SINK))
        for i, r in enumerate(radii)
    ]
    top = bm.verts.new((at[0] + apex[0], at[1] + apex[1], apex[2]))
    for i in range(n):
        bm.faces.new((ring[i], ring[(i + 1) % n], top))
    bm.faces.new(list(reversed(ring)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    kit._add(obj, name, mat, 0.0)


def build(kit: Kit) -> None:
    # Alternating long and short base radii flute each pyramid into ridges and valleys, as the concept's spires are.
    pyramid(kit, "big", (-1.5, 0.0), [3.7, 2.3, 3.6, 2.2, 3.8, 2.4, 3.5, 2.1], (0.3, 0.2, 7.5), "glass", turn=0.2)
    pyramid(kit, "small", (3.0, -1.2), [1.9, 1.3, 1.8, 1.2, 1.9, 1.3], (0.1, -0.1, 3.6), "glass_side", turn=0.5)
    pyramid(kit, "shard", (1.4, 2.8), [0.8, 0.6, 0.75, 0.6], (0.4, 0.3, 1.6), "glass_dark", turn=0.3)
    pyramid(kit, "chip", (-4.8, -2.2), [0.7, 0.5, 0.7, 0.5], (0.1, 0.0, 1.2), "glass_side", turn=0.1)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("glass_spire", args, view_size=16.0)


if __name__ == "__main__":
    main()
