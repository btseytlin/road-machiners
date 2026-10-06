"""Shared style, sizes and checks for the chassis base models.

A base is one whole-body model per chassis. It fills the chassis grid footprint: rows x CELL_ALONG along Blender X,
columns x CELL_ACROSS across Blender Y, nose at +X, truck left at +Y. Its origin is the physics collider center,
so Z = half_height is the deck top and Z = -half_height the collider bottom.
Kit parts from the shared kit stand on the base at the row<y>_<x> sockets, one per cell. Core parts and engines on their
engine mount cells stand lower, at the floor<y>_<x> sockets: the engine bay under a hood cutout, the cab floor or the bed floor.

Style: big flat panels and chunky slabs that read at the default game zoom. No detail under about 10 cm.
Few strong color blocks: paint body, trim accents, dark glass, bright lamps, dark underbody.
"""

from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Vector

from kit import CELL_ACROSS, CELL_ALONG, Kit, Vec3
from parts_common_core import COLORS, FIT_SLACK
from shapes import prism

BASE_COLORS = {
    **COLORS,
    "trim": 0x7E8A5A,  # FACTION_COLORS.player.cab, a stand-in: the game swaps it for the faction cab color
    "glass": 0x2A3438,  # PAL.wheel mixed toward PAL.water
    "light": 0xFFF0A0,  # PAL.flash, a stand-in: the game swaps it for the lamp material
    "under": 0x2E2A26,  # PAL.wheel lifted, for bumpers, flares and the underbody
}

SKIRT = 0.22  # the body hangs this far below the collider bottom, so the wheels tuck into arches
INSET = 0.04  # body sides stand this far inside the footprint, so mounted plates and flares cover them
ARCH_CLEARANCE = 0.06  # between a wheel and its arch
ARCH_SEGMENTS = 8  # straight edges around each arch, for the low-poly look
FLARE = 0.09  # radial width of the dark fender flare around an arch
SUSPENSION_REST = 0.4  # PHYSICS.truck.suspensionRest: the wheel hub hangs this far below the wheel mount


class Grid:
    """A chassis grid in base space. Rows run from the nose, columns from the left side."""

    def __init__(self, rows: int, cols: int, half_height: float) -> None:
        self.rows = rows
        self.cols = cols
        self.half_x = rows * CELL_ALONG / 2
        self.half_y = cols * CELL_ACROSS / 2
        self.top = half_height
        self.bottom = -half_height - SKIRT

    def row_x(self, y: float) -> float:
        """Blender X of row y's center. Fractions give row edges: row_x(y - 0.5) is its front edge."""
        return self.half_x - CELL_ALONG * (y + 0.5)

    def col_y(self, x: float) -> float:
        """Blender Y of column x's center. Fractions give column edges."""
        return self.half_y - CELL_ACROSS * (x + 0.5)


def arch_profile(g: Grid, wheels_x: list[float], hub_z: float, radius: float, top: float) -> list[tuple[float, float]]:
    """A side panel's XZ outline from the body bottom to top, with a low-poly arch cut up around each wheel."""
    r = radius + ARCH_CLEARANCE
    pts = [(-g.half_x + INSET, g.bottom)]
    for wx in sorted(wheels_x):
        for k in range(ARCH_SEGMENTS + 1):
            a = math.pi * (1 - k / ARCH_SEGMENTS)
            z = max(g.bottom, hub_z + r * math.sin(a))
            pts.append((wx + r * math.cos(a), z))
    pts += [(g.half_x - INSET, g.bottom), (g.half_x - INSET, top), (-g.half_x + INSET, top)]
    return pts


def flare(kit: Kit, name: str, g: Grid, wx: float, hub_z: float, radius: float, y0: float, y1: float, bottom: float | None = None) -> None:
    """A dark low-poly ring over the top of one arch, from the body bottom (or bottom) on both sides."""
    low = g.bottom if bottom is None else bottom
    r0 = radius + ARCH_CLEARANCE
    r1 = r0 + FLARE
    inner, outer = [], []
    for k in range(ARCH_SEGMENTS + 1):
        a = math.pi * k / ARCH_SEGMENTS
        inner.append((wx + r0 * math.cos(a), max(low, hub_z + r0 * math.sin(a))))
        outer.append((wx + r1 * math.cos(a), max(low, hub_z + r1 * math.sin(a))))
    prism(kit, name, outer + list(reversed(inner)), y0, y1, "under")


def level_sockets(
    kit: Kit, g: Grid, prefix: str, heights: list[float], fronts: dict[int, float] | None = None, cells: dict[tuple[int, int], float] | None = None
) -> None:
    """One <prefix><y>_<x> socket per grid cell: row for where kit parts stand, floor for core parts and mounted engines.

    heights[y] is the level of row y. cells gives a different level at column x, row y, keyed (x, y), where the surface
    under that cell is not the row's: a low fender beside a narrow hood, or an engine cutout.
    The socket's X is the front edge of the surface on that row, the row's own front edge unless fronts gives a lower one.
    The view moves an item back until its front edge is behind it, so nothing overhangs a raked windshield.
    """
    if len(heights) != g.rows:
        raise ValueError(f"{len(heights)} {prefix} heights for {g.rows} rows")
    levels = cells or {}
    outside = [c for c in levels if not (0 <= c[0] < g.cols and 0 <= c[1] < g.rows)]
    if outside:
        raise ValueError(f"{prefix} cells {outside} lie outside the {g.cols}x{g.rows} grid")
    for y, z in enumerate(heights):
        for x in range(g.cols):
            kit.socket(f"{prefix}{y}_{x}", ((fronts or {}).get(y, g.row_x(y - 0.5)), g.col_y(x), levels.get((x, y), z)))


def surface_z(g: Grid, x: int, y: int) -> float:
    """The height of the built base's top surface at the center of column x, row y, for cells over a slope or a step.

    Call it after the whole body is built. Raises when nothing lies under the cell center.
    """
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    hit, loc, *_ = bpy.context.scene.ray_cast(depsgraph, Vector((g.row_x(y), g.col_y(x), 10.0)), Vector((0, 0, -1)))
    if not hit:
        raise RuntimeError(f"No base surface under cell {x},{y}")
    return round(loc.z, 3)


def check_base(kit: Kit, name: str, g: Grid) -> None:
    """Raises if any vertex leaves the chassis footprint in X or Y."""
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in kit._parts:
        for v in obj.data.vertices:
            p = obj.matrix_world @ v.co
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    print(f"{name} bounds x {lo.x:.3f}..{hi.x:.3f} y {lo.y:.3f}..{hi.y:.3f} z {lo.z:.3f}..{hi.z:.3f}")
    if lo.x < -g.half_x - FIT_SLACK or hi.x > g.half_x + FIT_SLACK or lo.y < -g.half_y - FIT_SLACK or hi.y > g.half_y + FIT_SLACK:
        raise RuntimeError(f"{name} leaves its {g.cols}x{g.rows} footprint: x {lo.x:.3f}..{hi.x:.3f}, y {lo.y:.3f}..{hi.y:.3f}")


def hull_mesh(name: str, points: list[Vec3]) -> bpy.types.Object:
    """A convex hull of points as an unregistered object, with coplanar triangles merged into flat faces."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new(p) for p in points]
    result = bmesh.ops.convex_hull(bm, input=verts)
    bmesh.ops.delete(bm, geom=result["geom_interior"] + result["geom_unused"], context="VERTS")
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def hull_layers(name: str, layers: list[tuple[float, float, float, float, float]]) -> bpy.types.Object:
    """A convex body from stacked plan outlines. Each layer is (z, x_front, x_back, half_y, chamfer): a rectangle with its corners cut."""
    pts: list[Vec3] = []
    for z, xf, xb, hy, c in layers:
        for y in (hy, -hy):
            pts += [(xf - c, y, z), (xb + c, y, z)]
        for x in (xf, xb):
            pts += [(x, hy - c, z), (x, -hy + c, z)]
    return hull_mesh(name, pts)


def arch_cut(obj: bpy.types.Object, wheels_x: list[float], hub_z: float, radius: float, wall_y: float, bottom: float) -> None:
    """Cuts a low-poly arch around each wheel through both side walls, outside wall_y, from the body bottom up."""
    r = radius + ARCH_CLEARANCE
    cutters = []
    for wx in wheels_x:
        for sign in (1, -1):
            ring = [(wx + r * math.cos(math.pi * k / ARCH_SEGMENTS), hub_z + r * math.sin(math.pi * k / ARCH_SEGMENTS)) for k in range(ARCH_SEGMENTS + 1)]
            ring += [(wx + r, bottom - 0.1), (wx - r, bottom - 0.1)]
            ys = (sign * wall_y, sign * (wall_y + 2.0))
            cutters.append([(x, y, z) for x, z in ring for y in ys])
    cut_hulls(obj, cutters)


def cut_hulls(obj: bpy.types.Object, cutters: list[list[Vec3]]) -> None:
    """Subtracts the convex hull of each point list from obj."""
    for i, points in enumerate(cutters):
        cutter = hull_mesh(f"{obj.name}_cutter{i}", points)
        mod = obj.modifiers.new(f"cut{i}", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.solver = "EXACT"
        mod.object = cutter
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter)


def cut_boxes(obj: bpy.types.Object, boxes: list[tuple[Vec3, Vec3]]) -> None:
    """Subtracts axis-aligned boxes, each given as (min corner, max corner), from obj."""
    cut_hulls(obj, [[(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])] for lo, hi in boxes])
