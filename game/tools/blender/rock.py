"""Desert boulder for the 'rock' obstacle.

Sized for a unit reference radius: the footprint radius is 1 m and the height is about 1.1 m.
The game scales it uniformly by the obstacle radius, turns it at random and tints the three rock materials.
Run: blender --background --python tools/blender/rock.py -- public/models/rock.glb [tmp/rock.png]
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
SEED = 11
# Faces whose normal points up steeper than this get rock_top. Faces pointing down get rock_dark.
TOP_NZ = 0.55
DARK_NZ = -0.2


def stone(kit: Kit, name: str, radius: float, height: float, loc: Vec3, sides: int, taper: float, rot: Vec3 = (0, 0, 0), dent_by: float = 0.0) -> bpy.types.Object:
    """A faceted chunk: a low-sided cylinder whose top ring shrinks by taper, then dented and painted by facing."""
    obj = kit.cylinder(name, radius, height, loc, "rock_side", rot=rot, vertices=sides, dent_by=dent_by)
    # The cylinder has two rings. Dents stay smaller than half the height, so z > 0 picks the top ring.
    for v in obj.data.vertices:
        if v.co.z > 0:
            v.co.x *= taper
            v.co.y *= taper
    paint_by_facing(obj)
    return obj


def paint_by_facing(obj: bpy.types.Object) -> None:
    """Gives each face rock_top, rock_side or rock_dark by the world direction it faces."""
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
    # Three stacked slabs, each shifted off the one below, so the top of every layer shows.
    stone(kit, "base", 0.8, 0.5, (0.04, 0.0, 0.2), sides=7, taper=0.82, rot=(0, 0, 0.3), dent_by=0.06)
    stone(kit, "middle", 0.56, 0.38, (-0.14, 0.1, 0.6), sides=6, taper=0.78, rot=(math.radians(9), math.radians(-7), 1.1), dent_by=0.05)
    stone(kit, "top", 0.32, 0.3, (-0.2, 0.2, 0.92), sides=5, taper=0.62, rot=(math.radians(-14), math.radians(10), 0.4), dent_by=0.04)
    # A split-off chunk on the front shoulder breaks up the round silhouette.
    stone(kit, "chunk", 0.34, 0.4, (0.4, -0.42, 0.16), sides=6, taper=0.66, rot=(math.radians(12), math.radians(8), 0.5), dent_by=0.05)
    # Loose stones at the base, inside the 1 m radius.
    stone(kit, "stone_front", 0.18, 0.2, (0.66, 0.44, 0.07), sides=5, taper=0.6, rot=(0, math.radians(12), 0.2), dent_by=0.03)
    stone(kit, "stone_left", 0.14, 0.13, (-0.34, -0.74, 0.05), sides=5, taper=0.55, rot=(math.radians(10), 0, 1.3), dent_by=0.02)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("rock", args, view_size=2.8)


if __name__ == "__main__":
    main()
