"""Tall rock spire for the 'crag' landmark.

Sized for a unit reference radius: the footprint radius is 1 m and the spire rises about 3.4 m.
The game scales it uniformly by the obstacle radius, 1.6 to 2.6 tiles, and turns it at random.
It is a stack of shifted, tapering blocks, like the weathered pillars in the Ex Machina references.
Run: blender --background --python tools/blender/crag.py -- public/models/crag.glb [tmp/crag.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402

COLORS = {
    "rock_top": 0xC98E68,  # PAL.stone.top
    "rock_side": 0xB47F5D,  # PAL.stone.side
    "rock_dark": 0x8A5E44,  # PAL.stone.dark
}
SEED = 41
TOP_NZ = 0.55
DARK_NZ = -0.2


def block(kit: Kit, name: str, size: Vec3, loc: Vec3, yaw: float, taper: float, dent_by: float) -> None:
    """A box whose top face shrinks by taper, painted by the way each face points."""
    obj = kit.box(name, size, loc, "rock_side", rot=(kit.rng.uniform(-0.05, 0.05), kit.rng.uniform(-0.05, 0.05), yaw), dent_by=dent_by)
    for v in obj.data.vertices:
        if v.co.z > 0:
            v.co.x *= taper
            v.co.y *= taper
    paint_by_facing(obj)


def paint_by_facing(obj: bpy.types.Object) -> None:
    mesh = obj.data
    mesh.materials.clear()
    for mat in ("rock_top", "rock_side", "rock_dark"):
        mesh.materials.append(bpy.data.materials[mat])
    mesh.update()
    turn = obj.rotation_euler.to_matrix()
    for poly in mesh.polygons:
        nz = (turn @ poly.normal).z
        poly.material_index = 0 if nz > TOP_NZ else 2 if nz < DARK_NZ else 1


def build(kit: Kit) -> None:
    # A wide broken base, then a narrowing column of blocks, each shifted off the one below.
    block(kit, "base", (1.7, 1.5, 0.7), (0, 0, 0.25), 0.2, 0.85, 0.06)
    block(kit, "base_chunk", (0.8, 0.7, 0.5), (0.7, -0.5, 0.2), 0.9, 0.8, 0.05)
    x, y, z = 0.0, 0.0, 0.6
    for i, (w, h) in enumerate(((1.1, 0.8), (0.95, 0.7), (0.9, 0.6), (0.7, 0.55), (0.55, 0.4))):
        x += kit.rng.uniform(-0.12, 0.12)
        y += kit.rng.uniform(-0.12, 0.12)
        block(kit, f"tier{i}", (w, w * kit.rng.uniform(0.8, 1.0), h), (x, y, z + h / 2), kit.rng.uniform(0, math.pi), 0.88, 0.04)
        z += h * 0.92
    # Fallen blocks at the foot.
    for i in range(3):
        a = kit.rng.uniform(0, math.tau)
        d = kit.rng.uniform(0.75, 0.95)
        s = kit.rng.uniform(0.2, 0.35)
        block(kit, f"fallen{i}", (s, s * 0.9, s * 0.8), (math.cos(a) * d, math.sin(a) * d, s * 0.3), a, 0.8, 0.03)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("crag", args, view_size=5)


if __name__ == "__main__":
    main()
