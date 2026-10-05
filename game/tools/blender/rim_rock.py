"""A chunk of the Fallen Sun's crater wall, for the 'rimRock' prop.

Reference radius 8 m: the chunk is 16 m long along X, about 9 m deep and 12 m tall. The game turns X along the rim and
overlaps chunks by up to half, so they read as one broken rock wall like the level concept's north rim. The steep,
faceted face looks at -Y, toward the crater, and the back slopes off toward +Y.
Run: blender --background --python tools/blender/rim_rock.py -- public/models/rim_rock.glb [tmp/rim_rock.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402

COLORS = {
    "rock_top": 0xBAB3A6,  # PAL.rimRock.top
    "rock_side": 0x948E84,  # PAL.rimRock.side
    "rock_dark": 0x6E6960,  # PAL.rimRock.dark
}
SEED = 53
TOP_NZ = 0.55
DARK_NZ = -0.2
LENGTH = 16.0  # m along X
PEAKS = 4  # faceted peaks along the chunk


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


def peak(kit: Kit, name: str, size: Vec3, loc: Vec3, yaw: float, lean: float) -> None:
    """A box drawn to a ridge: its top pinches to a narrow crest pushed back toward +Y, so the front face is a steep
    facet and the back slopes off."""
    obj = kit.box(name, size, loc, "rock_side", rot=(lean, kit.rng.uniform(-0.08, 0.08), yaw), dent_by=0.35)
    for v in obj.data.vertices:
        if v.co.z > 0:
            v.co.x *= kit.rng.uniform(0.25, 0.55)
            v.co.y = v.co.y * 0.3 + size[1] * 0.15
    paint_by_facing(obj)


def build(kit: Kit) -> None:
    step = LENGTH / PEAKS
    for k in range(PEAKS):
        x = -LENGTH / 2 + step * (k + 0.5) + kit.rng.uniform(-0.8, 0.8)
        h = kit.rng.uniform(8.0, 12.0)
        w = step * kit.rng.uniform(1.2, 1.6)
        d = kit.rng.uniform(7.0, 9.0)
        peak(kit, f"peak{k}", (w, d, h), (x, kit.rng.uniform(0.0, 1.0), h / 2), kit.rng.uniform(-0.25, 0.25), math.radians(kit.rng.uniform(-6, 2)))
    # A low talus apron along the crater face, and fallen blocks on it.
    peak(kit, "apron", (LENGTH, 4.0, 2.5), (0, -4.0, 1.0), 0.0, 0.0)
    for k in range(5):
        s = kit.rng.uniform(1.0, 2.0)
        obj = kit.box(f"block{k}", (s, s * 0.9, s * 0.8), (kit.rng.uniform(-7, 7), kit.rng.uniform(-6.5, -4.5), s * 0.3), "rock_side", rot=(0, 0, kit.rng.uniform(0, math.tau)), dent_by=0.15)
        paint_by_facing(obj)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("rim_rock", args, view_size=34.0)


if __name__ == "__main__":
    main()
