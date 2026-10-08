"""Shape helpers built on Kit, shared by the asset scripts in this folder.

Each helper adds parts through the public Kit API, so they join and export like any other part.
"""

from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Vector

from kit import Kit, Vec3


def strut(
    kit: Kit,
    name: str,
    start: Vec3,
    end: Vec3,
    thick: float,
    mat: str,
    sides: int = 0,
    dent_by: float = 0.0,
) -> bpy.types.Object:
    """Adds a beam from start to end. sides=0 gives a square box, otherwise a cylinder with that many sides."""
    a, b = Vector(start), Vector(end)
    axis = b - a
    mid = tuple((a + b) / 2)
    rot = tuple(axis.to_track_quat("Z", "Y").to_euler())
    if sides:
        return kit.cylinder(name, thick / 2, axis.length, mid, mat, rot=rot, vertices=sides, dent_by=dent_by)
    return kit.box(name, (thick, thick, axis.length), mid, mat, rot=rot, dent_by=dent_by)


def taper(obj: bpy.types.Object, top: float, bottom: float = 1.0) -> None:
    """Scales the local XY of the upper and lower vertices of a Z-axis part. top=0.1 on a cylinder makes a cone."""
    for v in obj.data.vertices:
        k = top if v.co.z > 0 else bottom
        v.co.x *= k
        v.co.y *= k


def wall_patches(kit: Kit, name: str, wall: bpy.types.Object, count: int, size: tuple[float, float], mats: list[str]) -> None:
    """Puts thin flat plates on random side faces of an upright, unrotated cylinder, for rust or repair patches.

    size is the largest plate's (width, height). Each plate gets a random size, tilt and dent, so plates read as
    ragged stains rather than windows.
    """
    center = Vector(wall.location)
    sides = [p for p in wall.data.polygons if abs(p.normal.z) < 0.1]
    half = max(v.co.z for v in wall.data.vertices)
    for i, poly in enumerate(kit.rng.sample(sides, count)):
        n = poly.normal
        width = size[0] * kit.rng.uniform(0.4, 1.0)
        height = size[1] * kit.rng.uniform(0.4, 1.0)
        z = kit.rng.uniform(-half + height / 2, half - height / 2)
        loc = center + Vector((poly.center.x, poly.center.y, z)) + n * 0.03
        tilt = kit.rng.uniform(-0.15, 0.15)
        kit.box(f"{name}{i}", (0.04, width, height), tuple(loc), kit.rng.choice(mats), rot=(tilt, 0, math.atan2(n.y, n.x)), dent_by=min(width, height) * 0.15)


def ladder(kit: Kit, name: str, base: Vec3, top_z: float, width: float, facing: float, mat: str, rung_gap: float = 0.7) -> None:
    """A vertical ladder from base up to top_z. facing is the yaw in radians that the ladder's climbing side faces."""
    bx, by, bz = base
    side = Vector((-math.sin(facing), math.cos(facing), 0)) * (width / 2)
    height = top_z - bz
    for s, sign in (("l", -1), ("r", 1)):
        kit.box(f"{name}_rail_{s}", (0.07, 0.07, height), (bx + side.x * sign, by + side.y * sign, bz + height / 2), mat)
    rungs = int(height / rung_gap)
    for i in range(1, rungs + 1):
        kit.box(f"{name}_rung{i}", (0.05, width, 0.05), (bx, by, bz + i * height / (rungs + 1)), mat, rot=(0, 0, facing))


def prism(kit: Kit, name: str, profile: list[tuple[float, float]], y0: float, y1: float, mat: str, lean: float = 0.0) -> bpy.types.Object:
    """Extrudes a closed XZ profile from Blender Y y0 to y1 as one mesh. lean shifts each vertex by -lean * z in Y."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    near = [bm.verts.new((x, y0 - lean * z, z)) for x, z in profile]
    far = [bm.verts.new((x, y1 - lean * z, z)) for x, z in profile]
    bm.faces.new(near)
    bm.faces.new(list(reversed(far)))
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((near[i], near[j], far[j], far[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return kit._add(obj, name, mat, 0.0)


def mound(kit: Kit, name: str, radius: float, height: float, at: tuple[float, float]) -> None:
    """A low faceted sand heap: a short cylinder with its top ring pulled in."""
    heap = kit.cylinder(name, radius, height, (at[0], at[1], height / 2 - 0.1), "sand", vertices=7, dent_by=0.15)
    for v in heap.data.vertices:
        if v.co.z > 0:
            v.co.x *= 0.45
            v.co.y *= 0.45


def loft(kit: Kit, name: str, sections: list[list[Vec3]], mat: str) -> None:
    """Joins equal-length rings of points, one per station, into one closed mesh with flat end caps."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in ring] for ring in sections]
    n = len(rings[0])
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    kit._add(obj, name, mat, 0.0)


def arc_panel(
    kit: Kit,
    name: str,
    x0: float,
    x1: float,
    a0: float,
    a1: float,
    r: float,
    cz: float,
    mat: str,
    thick: float = 0.6,
    segs: int = 1,
    r1: float | None = None,
    tear: float = 0.0,
    dent_by: float = 0.0,
) -> bpy.types.Object:
    """A solid curved panel round a horizontal axis along X at height cz, from x0 to x1, outer face at radius r.

    Angles are radians from the top, positive toward -Y. r1 gives the outer radius at x1 for a flared panel, r at x0.
    tear pulls each column's ends in along X by up to that many meters, so the ends read as torn.
    """
    far = r if r1 is None else r1
    bm = bmesh.new()
    cols = []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        col = []
        for x, rr in ((x0 + kit.rng.uniform(0, tear), r), (x1 - kit.rng.uniform(0, tear), far)):
            for d in (rr, rr - thick):
                col.append(bm.verts.new((x, -math.sin(a) * d, cz + math.cos(a) * d)))
        cols.append(col)  # outer at x0, inner at x0, outer at x1, inner at x1
    for i in range(segs):
        p, q = cols[i], cols[i + 1]
        bm.faces.new((p[0], p[2], q[2], q[0]))
        bm.faces.new((p[1], q[1], q[3], p[3]))
        bm.faces.new((p[0], q[0], q[1], p[1]))
        bm.faces.new((p[2], p[3], q[3], q[2]))
    for c in (cols[0], cols[-1]):
        bm.faces.new((c[0], c[1], c[3], c[2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return kit._add(obj, name, mat, dent_by)
