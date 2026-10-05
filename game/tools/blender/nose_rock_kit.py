"""The faceted rock masses of Nose (C5): a shared heightfield builder for nose_rise and nose_crag.

Both models stand in one frame, the site frame of Nose's interior: the origin is the site center at ground level,
+X runs along the ship toward its nose, +Y runs toward the south gate, and Z is up. Meters throughout. The interior
turns the frame to the real gate bearing.

A mass is a grid of 8 m cells over its footprint. Each node gets a height from the mass's own function, a seeded
jitter that makes the facets, and a seeded sideways push. Every cell is two triangles, painted by the way each faces.
Cells at the footprint's edge get a skirt down below the ground, so the mass never floats. Everything stays inside
CLIP meters of the site center, so it lies inside the curtain.
"""

from __future__ import annotations

import math
import sys
from collections.abc import Callable
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402

CELL = 8.0
FRONT_V = 4.0  # where the front row of nodes lies, meters back from the center. A mass's front edge is a straight line
CLIP = 120.0  # nothing reaches past this radius: the curtain lies 123 m out, and its wall a little in
SKIRT_Z = -2.0
# The WNW gate's open ground in the site frame: center and radius in meters. No mass covers it.
GATE_WNW = (92.0, -80.0, 34.0)

# Colors from src/render/palette.ts, orange-brown as C5's rock.
COLORS = {
    "rock_a": 0xA97951,  # PAL.rust.top mixed half and half with PAL.sand[0]
    "rock_b": 0x9D6642,  # PAL.rust.top mixed 70 to 30 with PAL.sand[0]
    "rock_c": 0xB99366,  # PAL.rust.top mixed one to three with PAL.sand[0]
    "dirt": 0xC9A878,  # PAL.sand[0]
    "timber": 0x6A4A2A,  # PAL.trunk
    "plank": 0x9A7A4A,  # PAL.crate
    "steel": 0x5A5A58,  # PAL.metal
}
TERRACE_FACES = ("timber", "plank", "steel", "timber", "plank")


def v_of(y: float) -> float:
    """Meters back from the site center, away from the south gate."""
    return -y


def in_gate(x: float, y: float, margin: float = 0.0) -> bool:
    gx, gy, gr = GATE_WNW
    return math.hypot(x - gx, y - gy) < gr + margin


def inside(x: float, y: float, front: Callable[[float], float], back_only: Callable[[float, float], bool] | None = None) -> bool:
    """Whether (x, y) is in the footprint: far from the south gate past front(x), inside CLIP, off the gate's ground."""
    if v_of(y) < front(x) or math.hypot(x, y) > CLIP or in_gate(x, y):
        return False
    return back_only is None or back_only(x, v_of(y))


def clamp_in(x: float, y: float) -> tuple[float, float]:
    """A node pulled back inside CLIP."""
    d = math.hypot(x, y)
    if d > CLIP - 0.5:
        k = (CLIP - 0.5) / d
        return x * k, y * k
    return x, y


def tone(nz: float, z: float, ground: float, rng_value: float) -> str:
    """A facet's rock tone from its slope and a seeded chance. Flat tops lean light, steep sides dark."""
    if nz > 0.85:
        return "rock_c" if rng_value < 0.6 else "rock_a"
    if nz > 0.55:
        return "rock_a" if rng_value < 0.7 else "rock_c"
    return "rock_b" if rng_value < 0.45 else "rock_a"


def heightfield(
    kit: Kit,
    name: str,
    height: Callable[[float, float], float],
    front: Callable[[float], float],
    back_only: Callable[[float, float], bool] | None,
    jitter: Callable[[float, float], float],
    terrace: Callable[[float, float], bool] | None = None,
) -> tuple[float, float]:
    """Builds one mass. height(x, v) is its surface in meters, jitter(x, v) the largest height jitter there, front(x)
    where its footprint begins in v. terrace(x, v), where true, paints the front skirt as a timber-and-scrap retaining
    wall. Returns the lowest and highest surface point."""
    xs = [-CLIP + i * CELL for i in range(int(2 * CLIP / CELL) + 2)]
    vs = [FRONT_V + i * CELL for i in range(int((CLIP - FRONT_V) / CELL) + 2)]
    nodes: dict[tuple[int, int], tuple[float, float, float]] = {}

    def node(i: int, j: int) -> tuple[float, float, float]:
        if (i, j) not in nodes:
            x, v = xs[i], vs[j]
            r = kit.rng
            px = x + r.uniform(-0.3, 0.3) * CELL
            pv = v if j == 0 else v + r.uniform(-0.3, 0.3) * CELL
            px, y = clamp_in(px, -pv)
            z = height(px, -y) + r.uniform(-1, 1) * jitter(px, -y)
            nodes[(i, j)] = (px, y, z)
        return nodes[(i, j)]

    cells = []
    for i in range(len(xs) - 1):
        for j in range(len(vs) - 1):
            cx, cv = (xs[i] + xs[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2
            if inside(cx, -cv, front, back_only):
                cells.append((i, j))
    have = set(cells)
    groups: dict[str, list[list[tuple[float, float, float]]]] = {}
    low, high = 1e9, -1e9

    def add(mat: str, pts: list[tuple[float, float, float]]) -> None:
        groups.setdefault(mat, []).append(pts)

    for i, j in cells:
        a, b, c, d = node(i, j), node(i + 1, j), node(i + 1, j + 1), node(i, j + 1)
        # Quad corners in v order are (a, b) at the cell's lower v and (d, c) at its upper v.
        tris = ([a, b, c], [a, c, d]) if (i + j) % 2 == 0 else ([a, b, d], [b, c, d])
        for t in tris:
            ux, uy, uz = (t[1][k] - t[0][k] for k in range(3))
            wx, wy, wz = (t[2][k] - t[0][k] for k in range(3))
            nx, ny, nz = uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx
            if nz < 0:
                t = [t[0], t[2], t[1]]
                nz = -nz
                nx, ny = -nx, -ny
            length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            add(tone(nz / length, sum(p[2] for p in t) / 3, 0.0, kit.rng.random()), t)
            for p in t:
                low, high = min(low, p[2]), max(high, p[2])
        # Skirts on the edges that border no other cell: the cell's own side, down below the ground.
        for (di, dj), (p, q) in (((0, -1), (a, b)), ((1, 0), (b, c)), ((0, 1), (c, d)), ((-1, 0), (d, a))):
            if (i + di, j + dj) in have:
                continue
            mat = "rock_b"
            if (di, dj) == (0, -1) and terrace is not None and terrace(*((p[0] + q[0]) / 2, v_of((p[1] + q[1]) / 2))):
                mat = TERRACE_FACES[(i + j) % len(TERRACE_FACES)]
            quad = [p, q, (q[0], q[1], SKIRT_Z), (p[0], p[1], SKIRT_Z)]
            # Face away from the cell: the normal of p -> q -> down is (-dy, dx).
            mx, my = (p[0] + q[0]) / 2 - (a[0] + c[0]) / 2, (p[1] + q[1]) / 2 - (a[1] + c[1]) / 2
            if -(q[1] - p[1]) * mx + (q[0] - p[0]) * my < 0:
                quad.reverse()
            add(mat, quad)
    for mat, polys in groups.items():
        mesh = bpy.data.meshes.new(f"{name}_{mat}")
        bm = bmesh.new()
        for poly in polys:
            verts = [bm.verts.new(p) for p in poly]
            try:
                bm.faces.new(verts)
            except ValueError:
                pass
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(f"{name}_{mat}", mesh)
        bpy.context.scene.collection.objects.link(obj)
        kit._add(obj, f"{name}_{mat}", mat, 0.0)
    return low, high
