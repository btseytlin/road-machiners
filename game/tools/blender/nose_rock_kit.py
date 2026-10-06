"""The faceted rock masses of Nose (C5): a shared heightfield builder for nose_rise and nose_crag.

Both models stand in one frame, the site frame of Nose's interior: the origin is the site center at ground level,
+X runs along the ship toward its nose, +Y runs toward the south gate, and Z is up. Meters throughout. The interior
turns the frame to the real gate bearing.

A mass is a grid of 8 m cells over its footprint. Each node gets a height from the mass's own function, a seeded
jitter that makes the facets, and a seeded sideways push. Every cell is two triangles, painted by the way each faces.
Cells at the footprint's edge get a skirt down below the ground, so the mass never floats on the open ground around
the site, which falls up to 10 m away from it. A floor under every cell closes the mass, so it has collision boxes.

The ship came down on a mountain, and the town's ring was built up to its flanks. Inside CLIP meters of the center a
mass may stand anywhere its own footprint says. Past it, only the mountain's arc carries rock, out to a ragged foot
REACH meters away. The arc's bearing is PHI, in degrees from +X toward the back (-Y). The curtain stops where the rock
meets it, so the rock closes the ring there. A gorge through the rock leads the WNW road and its pad to the gate.
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
# A node's random push, as a share of CELL, along x and back from the front edge. A bent front adds to the push back.
PUSH = 0.3
# The most a node can end up from its cell corner, as a share of CELL: both pushes, and the steepest front bend.
PUSH_REACH = 0.6
FRONT_V = 4.0  # where the front row of nodes lies, meters back from the center. A mass's front edge is a straight line
CLIP = 120.0  # off the mountain's arc nothing reaches past this radius: the curtain lies 123 m out, and its wall a little in
SKIRT_Z = -12.0  # deep enough to meet the open ground, which falls up to 10 m around the site
# The mountain's arc past CLIP, and its foot: REACH meters from the center mid-arc, narrowing to REACH_ENDS at the
# arc's ends, give or take REACH_WOBBLE. The west wall ends where the straight front meets the curtain, at 2 degrees,
# and the east wall where the bent front meets it, at 190. The WNW gate stands in a gorge through the rock.
PHI = (0.0, 215.0)
REACH = 220.0
REACH_ENDS = 160.0
REACH_WOBBLE = 12.0
# Off the yard, the front edge bends toward the gate east of BEND_X, so the east wall ends in rock and not on the sand.
BEND_X = -105.0
BEND = 1.6  # meters toward the gate per meter past BEND_X
# The WNW gate's open ground in the site frame: center and radius in meters. No mass covers it. Its road runs out
# straight from the center through the gate, in a gorge GORGE_HALF meters to either side of that line, so the gate's
# pad and the road stay clear.
GATE_WNW = (92.0, -80.0, 34.0)
GORGE_HALF = 30.0

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


def in_gate(x: float, y: float) -> bool:
    """Whether (x, y) is on the WNW gate's open ground, or in the gorge its road runs out through."""
    gx, gy, gr = GATE_WNW
    if math.hypot(x - gx, y - gy) < gr:
        return True
    gd = math.hypot(gx, gy)
    along = (x * gx + y * gy) / gd
    return along > gd and abs(x * gy - y * gx) / gd < GORGE_HALF


def bent(x: float) -> float:
    """How far the front edge bends toward the gate at x, in meters."""
    return max(0.0, BEND_X - x) * BEND


def phi(x: float, y: float) -> float:
    """The bearing of (x, y) in degrees from +X toward the back, in [0, 360)."""
    return math.degrees(math.atan2(v_of(y), x)) % 360.0


def on_arc(x: float, y: float) -> bool:
    return PHI[0] <= phi(x, y) <= PHI[1]


def mid_arc(x: float, y: float) -> float:
    """0 at the arc's ends and off it, rising to 1 mid-arc, behind the ship. The mountain is broadest and highest there."""
    if not on_arc(x, y):
        return 0.0
    return math.sin(math.pi * (phi(x, y) - PHI[0]) / (PHI[1] - PHI[0]))


def reach(x: float, y: float) -> float:
    """The outer radius of rock at the bearing of (x, y): the ragged mountain foot on the arc, else CLIP."""
    if not on_arc(x, y):
        return CLIP
    a = math.radians(phi(x, y))
    wobble = REACH_WOBBLE * (0.6 * math.sin(3 * a + 0.7) + 0.4 * math.sin(7 * a + 2.1))
    return REACH_ENDS + (REACH - REACH_ENDS) * mid_arc(x, y) ** 0.6 + wobble


def past_ring(x: float, y: float) -> float:
    """0 inside CLIP, rising to 1 at the mountain's foot."""
    d = math.hypot(x, y)
    return min(1.0, max(0.0, (d - CLIP) / (reach(x, y) - CLIP))) if d > CLIP else 0.0


def inside(x: float, y: float, front: Callable[[float], float], back_only: Callable[[float, float], bool] | None = None) -> bool:
    """Whether (x, y) is in the footprint: far from the south gate past front(x), off the gate's ground."""
    if v_of(y) < front(x) or in_gate(x, y):
        return False
    return back_only is None or back_only(x, v_of(y))


def within_reach(center: tuple[float, float], corners: list[tuple[float, float]]) -> bool:
    """Whether a cell is rock by its reach. Off the arc, its center lies inside CLIP, and its nodes are pulled onto
    CLIP, so the rock meets the curtain. On the arc, every corner lies inside the reach by more than a node's push, and
    the foot stays as ragged as its cells. A cell past CLIP has every corner on the arc, so no pulled node joins it: a
    cell with pulled and free nodes folds over itself, and a folded mass has no inside for its collision boxes."""
    if math.hypot(*center) > CLIP and not all(on_arc(x, y) for x, y in corners):
        return False
    return all(not on_arc(x, y) or math.hypot(x, y) < reach(x, y) - PUSH_REACH * CELL for x, y in corners)


def pulled_in(corner: tuple[float, float], x: float, y: float) -> tuple[float, float]:
    """A node off the arc, by its cell corner, pulled back inside CLIP."""
    d = math.hypot(x, y)
    if on_arc(*corner) or d <= CLIP - 0.5:
        return x, y
    k = (CLIP - 0.5) / d
    return x * k, y * k


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
    # Rows run along the front edge: row j lies ws[j] meters behind it, so the edge follows its bend, not in steps.
    far = REACH + REACH_WOBBLE
    xs = [-far + i * CELL for i in range(int(2 * far / CELL) + 2)]
    ws = [i * CELL for i in range(int((far - min(front(x) for x in xs)) / CELL) + 2)]
    nodes: dict[tuple[int, int], tuple[float, float, float]] = {}

    def node(i: int, j: int) -> tuple[float, float, float]:
        if (i, j) not in nodes:
            r = kit.rng
            px = xs[i] + r.uniform(-PUSH, PUSH) * CELL
            pv = front(px) + ws[j] + (0.0 if j == 0 else r.uniform(-PUSH, PUSH) * CELL)
            px, y = pulled_in((xs[i], -(front(xs[i]) + ws[j])), px, -pv)
            z = height(px, -y) + r.uniform(-1, 1) * jitter(px, -y)
            nodes[(i, j)] = (px, y, z)
        return nodes[(i, j)]

    cells = []
    for i in range(len(xs) - 1):
        for j in range(len(ws) - 1):
            cx = (xs[i] + xs[i + 1]) / 2
            cv = front(cx) + (ws[j] + ws[j + 1]) / 2
            corners = [(x, -(front(x) + w)) for x in xs[i : i + 2] for w in ws[j : j + 2]]
            if inside(cx, -cv, front, back_only) and within_reach((cx, -cv), corners):
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
        # A floor under the cell, facing down, closes the mass: scripts/prop-shapes.mjs finds its solid by ray parity.
        floor = [(p[0], p[1], SKIRT_Z) for p in (a, b, c, d)]
        turn = sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(floor, floor[1:] + floor[:1]))
        add("rock_b", floor if turn < 0 else floor[::-1])
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
