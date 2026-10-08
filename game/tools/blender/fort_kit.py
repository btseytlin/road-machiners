"""Shared builders for the fortress pieces and the scrap camps' style: wall, tower, gatehouse and inner gate.

Each fort_scrap_<piece>.py script calls run(style, piece). Scrap is rust and junk: patch sheets over a rusty core,
a ragged top of mismatched sheets, crates and poles, a barricade gate between two container stacks and a chicane for
the inner gate. The other styles build their pieces in their own fort_<style>_kit.py files, which reuse this file's
geometry helpers.

Sizes match the FORTRESS reference numbers in src/data/fortress.ts, with one tile = 4 m (AS4):
- wall: one straight section 8.0 m along X (FORTRESS.wallLength, 2 tiles), centered on the origin, 12 m tall,
  under 3 m thick and symmetric across Y, so either side may face out. The game stretches it along X only.
- tower: a 6 m footprint centered on the origin, 16 m tall.
- gate: 10 m deep along X and 20 m wide along Y, 16 m tall. Its outer face is the plane X = 0, and it faces +X, so
  the origin is the center of the outer face at ground level and the body runs to X = -10. Two container stacks
  flank a junk barricade with shut double doors. Nothing roofs the opening.
- inner: the inner gate in the curtain where a barbican meets it. 4 m deep along X and 10 m wide along Y, centered
  on the origin, 13 m tall, with a staggered wreck and container chicane between two container stacks. It faces +X.

Every piece has a skirt to 1.2 m below its ground point, so it never floats on uneven ground.
Faces are kept just inside 0.5 m collision cells, so face detail does not widen the collider (scripts/shape-lib.mjs).
"""

from __future__ import annotations

import math
import sys
from collections.abc import Callable
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

XY = tuple[float, float]

SKIRT = 1.2  # m below the ground point
WALL_LENGTH = 8.0  # FORTRESS.wallLength in meters
WALL_HEIGHT = 12.0
WALL_DEPTH = 2.6
TOWER_SIZE = 6.0
TOWER_HEIGHT = 16.0
GATE_DEPTH = 10.0
GATE_WIDTH = 20.0
GATE_HEIGHT = 16.0
INNER_DEPTH = 4.0
INNER_WIDTH = 10.0
INNER_HEIGHT = 13.0

# Colors from src/render/palette.ts. soot is darker than any palette color.
STYLES: dict[str, dict[str, int]] = {
    "scrap": {
        "body": 0x8A4A2A,  # PAL.rust.top
        "shade": 0x5E3420,  # PAL.rust.side
        "dark": 0x3A2418,  # PAL.rust.dark
        "light": 0x8A8A84,  # PAL.metalLight
        "trim": 0x9A7A4A,  # PAL.crate, scrap timber
        "door": 0x5A5A58,  # PAL.metal
        "door_dark": 0x2A2420,  # PAL.wheel
        "iron": 0x5A5A58,  # PAL.metal
        "accent": 0x8E2E22,  # FACTION_COLORS.raiders.top, faded raider paint
        "soot": 0x1E1A18,
    },
}

SEEDS = {("scrap", "wall"): 301, ("scrap", "tower"): 302, ("scrap", "gate"): 303, ("scrap", "inner"): 305}


# --- Geometry helpers -------------------------------------------------------------------------------------------


def rect(x0: float, x1: float, y0: float, y1: float) -> list[XY]:
    """A counterclockwise rectangle, so each edge's outward normal is its direction turned clockwise."""
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def edges(poly: list[XY]) -> list[tuple[XY, XY]]:
    return [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]


def frame(p0: XY, p1: XY) -> tuple[float, XY, XY, float]:
    """Length, unit direction, outward normal and yaw of a counterclockwise polygon edge."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dy)
    t = (dx / length, dy / length)
    return length, t, (t[1], -t[0]), math.atan2(dy, dx)


def extrude(kit: Kit, name: str, bottom: list[XY], top: list[XY], z0: float, z1: float, mat: str) -> bpy.types.Object:
    """A closed solid from the bottom polygon at z0 to the top polygon at z1. Both list matching corners."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    low = [bm.verts.new((x, y, z0)) for x, y in bottom]
    high = [bm.verts.new((x, y, z1)) for x, y in top]
    bm.faces.new(list(reversed(low)))
    bm.faces.new(high)
    n = len(bottom)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((low[i], low[j], high[j], high[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return kit._add(obj, name, mat, 0.0)


def inset(poly: list[XY], d: float) -> list[XY]:
    """Moves every edge of a convex counterclockwise polygon d meters inward."""
    lines = []
    for p0, p1 in edges(poly):
        _, t, n, _ = frame(p0, p1)
        lines.append(((p0[0] - n[0] * d, p0[1] - n[1] * d), t))
    out = []
    for i in range(len(lines)):
        (a, ta), (b, tb) = lines[i - 1], lines[i]
        cross = ta[0] * tb[1] - ta[1] * tb[0]
        s = ((b[0] - a[0]) * tb[1] - (b[1] - a[1]) * tb[0]) / cross
        out.append((a[0] + ta[0] * s, a[1] + ta[1] * s))
    return out


def plate(kit: Kit, name: str, edge: tuple[XY, XY], u: float, z: float, w: float, h: float, out: float, mat: str, tilt: float = 0.0, dent: float = 0.0, depth: float = 0.0) -> None:
    """A flat plate on a vertical face, centered u meters along the edge at height z, sticking out `out` meters.

    depth > 0 moves the plate that far inside the face instead, as for a parapet behind the face line.
    """
    p0, p1 = edge
    _, t, n, yaw = frame(p0, p1)
    off = -depth if depth else 0.0
    thick = out * 2 if not depth else out
    x = p0[0] + t[0] * u + n[0] * off
    y = p0[1] + t[1] * u + n[1] * off
    kit.box(name, (w, thick, h), (x, y, z), mat, rot=(0, tilt, yaw), dent_by=dent)


# --- Style detail ---------------------------------------------------------------------------------------------


def skin(kit: Kit, name: str, edge: tuple[XY, XY], z0: float, z1: float) -> None:
    """Covers one vertical face from z0 to z1 with patch sheets of every color on a jittered grid, tilted and battered."""
    length = frame(*edge)[0]
    z0 = max(z0, 0.0)
    mats = ("body", "body", "body", "shade", "dark", "iron", "light", "trim", "accent")
    cols = max(1, round(length / 2.2))
    rows = max(1, round((z1 - z0) / 1.8))
    cw, rh = length / cols, (z1 - z0) / rows
    for r in range(rows):
        for c in range(cols):
            if kit.rng.random() < 0.2:
                continue
            w = min(cw * kit.rng.uniform(0.8, 1.25), length - 0.2)
            h = rh * kit.rng.uniform(0.75, 1.2)
            u = min(max((c + 0.5) * cw + kit.rng.uniform(-0.3, 0.3) * cw, w / 2 + 0.1), length - w / 2 - 0.1)
            z = min(max(z0 + (r + 0.5) * rh + kit.rng.uniform(-0.2, 0.2) * rh, z0 + h / 2), z1 - h / 2)
            plate(kit, f"{name}_sheet{r}_{c}", edge, u, z, w, h, 0.05, kit.rng.choice(mats), tilt=kit.rng.uniform(-0.2, 0.2), dent=0.04)
    for i in range(max(1, int(length / 3))):
        u = kit.rng.uniform(0.4, length - 0.4)
        plate(kit, f"{name}_strap{i}", edge, u, (z0 + z1) / 2, 0.18, (z1 - z0) * 0.9, 0.07, "dark", tilt=kit.rng.uniform(-0.08, 0.08))


def band(kit: Kit, name: str, edge: tuple[XY, XY], z: float) -> None:
    """A welded rail across a face just under the top."""
    length = frame(*edge)[0]
    plate(kit, f"{name}_rail", edge, length / 2, z, length, 0.22, 0.08, "iron", tilt=kit.rng.uniform(-0.02, 0.02))


def crown(kit: Kit, name: str, edge: tuple[XY, XY], z: float, top: float) -> None:
    """A ragged junk top from z to top, just inside the face line: mismatched sheets, stacked crates and bent poles.

    Widths, heights and kinds vary with no repeat, and one tall piece reaches `top`, so every crown tops out there.
    """
    length = frame(*edge)[0]
    reach = top - z
    u, i = 0.25, 0
    while u < length - 0.55:
        w = min(kit.rng.uniform(0.4, 2.2), length - 0.25 - u)
        c = u + w / 2
        pick = kit.rng.random()
        if pick < 0.5:
            h = kit.rng.uniform(0.3 * reach, reach)
            plate(kit, f"{name}_sheet{i}", edge, c, z + h / 2, w, h, 0.1, kit.rng.choice(("body", "shade", "iron", "dark", "light")), tilt=kit.rng.uniform(-0.35, 0.35), dent=0.05, depth=0.2)
        elif pick < 0.75:
            h1 = kit.rng.uniform(0.25, 0.5) * reach
            h2 = kit.rng.uniform(0.15, 0.35) * reach
            plate(kit, f"{name}_crate{i}", edge, c, z + h1 / 2, w * 0.85, h1, 0.5, kit.rng.choice(("trim", "shade", "body")), tilt=kit.rng.uniform(-0.1, 0.1), dent=0.05, depth=0.25)
            plate(kit, f"{name}_crate{i}b", edge, c + kit.rng.uniform(-0.2, 0.2), z + h1 + h2 / 2, w * 0.5, h2, 0.4, kit.rng.choice(("iron", "dark", "trim")), tilt=kit.rng.uniform(-0.25, 0.25), dent=0.05, depth=0.3)
        else:
            h = kit.rng.uniform(0.5 * reach, reach)
            plate(kit, f"{name}_pole{i}", edge, c, z + h / 2, 0.16, h, 0.16, "iron", tilt=kit.rng.uniform(-0.35, 0.35), depth=0.4)
        u += w * kit.rng.uniform(0.5, 1.1)
        i += 1
    plate(kit, f"{name}_high", edge, length * kit.rng.uniform(0.3, 0.7), (z + top) / 2, 0.9, reach, 0.1, "iron", tilt=kit.rng.uniform(-0.1, 0.1), depth=0.2)


def block(kit: Kit, name: str, poly: list[XY], z1: float, top: float, faces: set[int] | None = None) -> None:
    """A rusty core with patch sheets, a rail and a junk top. poly is counterclockwise and convex.

    The core rises from the skirt to z1 and the crown from z1 to top. faces lists the edge indices that get detail,
    or None for all of them.
    """
    shown = [(i, e) for i, e in enumerate(edges(poly)) if faces is None or i in faces]
    extrude(kit, f"{name}_core", poly, poly, -SKIRT, z1, "shade")
    for i, e in shown:
        skin(kit, f"{name}_face{i}", e, 0.0, z1 - 1.0)
        band(kit, f"{name}_band{i}", e, z1 - 0.5)
    for i, e in shown:
        crown(kit, f"{name}_crown{i}", e, z1, top)
    extrude(kit, f"{name}_deck", inset(poly, 0.05), inset(poly, 0.05), z1 - 0.1, z1 + 0.15, "trim")


# --- Doors ----------------------------------------------------------------------------------------------------


def leaves(kit: Kit, name: str, x: float, face: int, width: float, height: float) -> None:
    """Shut double doors of dented plate, patched and braced, on the plane x. face is +1 for a +X face and -1 for -X."""
    leaf = width / 2 - 0.05
    for side, sign in (("l", -1), ("r", 1)):
        y = sign * (leaf / 2 + 0.05)
        kit.box(f"{name}_{side}", (0.4, leaf, height), (x, y, height / 2), "door", dent_by=0.05)
        for k in range(5):
            w = kit.rng.uniform(1.0, leaf * 0.8)
            h = kit.rng.uniform(1.0, 2.4)
            kit.box(f"{name}_{side}_patch{k}", (0.1, w, h), (x + face * 0.2, y + kit.rng.uniform(-(leaf - w) / 2, (leaf - w) / 2), kit.rng.uniform(h / 2, height - h / 2)),
                    kit.rng.choice(("body", "shade", "accent", "trim")), rot=(kit.rng.uniform(-0.2, 0.2), 0, 0), dent_by=0.04)
        for k in range(3):
            kit.box(f"{name}_{side}_brace{k}", (0.12, leaf * 1.1, 0.25), (x + face * 0.22, y, height * (k + 0.5) / 3), "dark", rot=(0.5 * sign * (1 if k % 2 else -1), 0, 0))
    kit.box(f"{name}_seam", (0.44, 0.12, height), (x, 0.0, height / 2), "soot")


# --- Pieces ---------------------------------------------------------------------------------------------------


def wall(kit: Kit) -> None:
    """One 8 m wall section along X, 12 m tall, detailed on both long faces."""
    half_l, half_d = WALL_LENGTH / 2, WALL_DEPTH / 2
    poly = rect(-half_l, half_l, -half_d, half_d)
    block(kit, "wall", poly, 10.6, WALL_HEIGHT, faces={0, 2})
    tier = 1.4
    for sign in (-1, 1):
        edge = edges(poly)[0 if sign < 0 else 2]
        for t in range(2):
            z = tier * (t + 0.5)
            plate(kit, f"wall_basket{sign}_{t}", edge, WALL_LENGTH / 2, z, WALL_LENGTH - 0.1, tier - 0.1, 0.1, "trim")
            for c in range(int(WALL_LENGTH / 1.0)):
                plate(kit, f"wall_mesh{sign}_{t}_{c}", edge, c * 1.0 + 0.05, z, 0.1, tier, 0.14, "iron")
            plate(kit, f"wall_frame{sign}_{t}", edge, WALL_LENGTH / 2, tier * (t + 1) - 0.06, WALL_LENGTH, 0.12, 0.15, "iron")
    for i in range(10):
        kit.cylinder(f"wall_coil{i}", 0.4, 0.14, (-half_l + 0.4 + i * 0.8, 0.0, WALL_HEIGHT - 0.4), "iron", rot=(0, math.pi / 2, 0), vertices=8)
    for sign in (-1, 1):
        for i in range(3):
            x = kit.rng.uniform(-half_l + 1.0, half_l - 1.0)
            kit.cylinder(f"wall_tire{sign}_{i}", 0.6, 0.35, (x, sign * (half_d - 0.05), 0.3), "door_dark", rot=(math.pi / 2, 0, 0), vertices=8)


def tower(kit: Kit) -> None:
    """A tower on a 6 m footprint, 16 m tall: stacked scrap boxes under a sheet lookout."""
    _scrap_stack(kit, "tower", (0.0, 0.0), 5.0, 5.0, dressed=True)


def _scrap_stack(kit: Kit, name: str, at: XY, sx: float, sy: float, dressed: bool = False) -> None:
    """Stacked scrap boxes leaning a little each way, with a sheet lookout on top at 16 m.

    dressed adds a sandbag base course and a net draped over the top box (R6).
    """
    x, y = at
    levels = [(-SKIRT, 5.0, 1.0, 0.0), (5.0, 9.4, 0.9, math.radians(4)), (9.4, 13.0, 0.95, math.radians(-5))]
    for k, (z0, z1, k_size, yaw) in enumerate(levels):
        w, d = sx * k_size, sy * (k_size if k != 1 else 0.96)
        c, s = math.cos(yaw), math.sin(yaw)
        poly = [(x + px * c - py * s, y + px * s + py * c) for px, py in rect(-w / 2, w / 2, -d / 2, d / 2)]
        extrude(kit, f"{name}_box{k}", poly, poly, z0, z1, "shade")
        for i, e in enumerate(edges(poly)):
            skin(kit, f"{name}_box{k}_face{i}", e, z0, z1)
            length = frame(*e)[0]
            for r in range(3):
                plate(kit, f"{name}_box{k}_rib{i}_{r}", e, (r + 0.5) * length / 3, (max(z0, 0) + z1) / 2, 0.15, z1 - max(z0, 0) - 0.2, 0.08, "shade")
        if k < 2:
            plate(kit, f"{name}_box{k}_lip", edges(poly)[0], frame(*edges(poly)[0])[0] / 2, z1, frame(*edges(poly)[0])[0], 0.25, 0.1, "iron")
    if dressed:
        for i, e in enumerate(edges(rect(x - sx / 2, x + sx / 2, y - sy / 2, y + sy / 2))):
            length = frame(*e)[0]
            for row in range(5):
                n = int(length / 0.9)
                for b in range(n):
                    plate(kit, f"{name}_bag{i}_{row}_{b}", e, (b + 0.5 + (0.25 if row % 2 else 0.0)) * length / n % length, 0.18 + row * 0.35, length / n - 0.06, 0.32, 0.1, "trim" if (b + row) % 3 else "light", dent=0.03)
            top_poly = rect(x - sx * 0.475, x + sx * 0.475, y - sy * 0.475, y + sy * 0.475)
            te = edges(top_poly)[i]
            for k in range(int(frame(*te)[0] / 1.2)):
                u = (k + 0.5) * 1.2
                plate(kit, f"{name}_net{i}_{k}a", te, u, 11.4, 0.07, 3.2, 0.05, "dark", tilt=0.6)
                plate(kit, f"{name}_net{i}_{k}b", te, u, 11.4, 0.07, 3.2, 0.05, "dark", tilt=-0.6)
    deck = rect(x - sx / 2 - 0.1, x + sx / 2 + 0.1, y - sy / 2 - 0.1, y + sy / 2 + 0.1)
    extrude(kit, f"{name}_deck", deck, deck, 13.0, 13.3, "trim")
    for i, e in enumerate(edges(deck)):
        crown(kit, f"{name}_crown{i}", e, 13.3, TOWER_HEIGHT - 0.6)
    kit.box(f"{name}_roof", (sx * 0.8, sy * 0.8, 0.12), (x, y, TOWER_HEIGHT - 0.3), "body", rot=(0, math.radians(8), 0), dent_by=0.05)
    for px, py in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        strut(kit, f"{name}_post{px}{py}", (x + px * sx * 0.35, y + py * sy * 0.35, 13.3), (x + px * sx * 0.35, y + py * sy * 0.35, TOWER_HEIGHT - 0.3 - px * 0.3), 0.15, "iron")
    strut(kit, f"{name}_spike", (x - sx * 0.3, y + sy * 0.3, 13.3), (x - sx * 0.3, y + sy * 0.3, TOWER_HEIGHT + 1.5), 0.12, "iron", sides=4)
    kit.box(f"{name}_flag", (0.05, 1.2, 0.8), (x - sx * 0.3, y + sy * 0.3 + 0.62, TOWER_HEIGHT + 1.0), "accent", dent_by=0.08)


def gate(kit: Kit) -> None:
    """The gate: two container stacks flank a junk barricade with shut double doors in the outer face at X = 0.

    The barricade is a ragged bed of crushed plate behind a front of leaning sheets and tires, and nothing roofs it.
    """
    d, hw = GATE_DEPTH, GATE_WIDTH / 2
    tw = 6.0
    for sign in (-1, 1):
        y0, y1 = (hw - tw, hw) if sign > 0 else (-hw, -(hw - tw))
        _scrap_stack(kit, f"gate_tower{sign}", (-d / 2 - 0.2, (y0 + y1) / 2), d - 1.0, tw - 0.6)
    inner = hw - tw + 0.2
    count = 5
    step = 2 * inner / count
    for k in range(count):
        h = kit.rng.uniform(4.5, 8.0)
        kit.box(f"gate_bed{k}", (6.0, step + 0.1, h + SKIRT), (-6.6, -inner + (k + 0.5) * step, (h - SKIRT) / 2), kit.rng.choice(("shade", "body", "dark", "shade")),
                rot=(kit.rng.uniform(-0.05, 0.05), kit.rng.uniform(-0.05, 0.05), kit.rng.uniform(-0.1, 0.1)), dent_by=0.08)
    for k in range(7):
        y = -inner + (k + 0.5) * 2 * inner / 7
        h = kit.rng.uniform(5.5, 9.5)
        kit.box(f"gate_lean{k}", (0.35, 2 * inner / 7 * 1.3, h), (-2.3 - kit.rng.uniform(0.0, 0.5), y, h / 2), kit.rng.choice(("body", "iron", "trim", "shade", "light")),
                rot=(kit.rng.uniform(-0.12, 0.12), kit.rng.uniform(0.0, 0.18), kit.rng.uniform(-0.15, 0.15)), dent_by=0.05)
    for k in range(5):
        y = -inner + (k + 0.5) * 2 * inner / 5
        kit.cylinder(f"gate_tire{k}", 0.7, 0.6, (-3.4, y, 0.7 + 1.4 * (k % 2)), "door_dark", rot=(0, math.pi / 2, 0), vertices=8)
    leaves(kit, "gate_door", -0.6, 1, 6.4, 6.5)
    for k in range(3):
        y = (k - 1) * 3.2
        top = kit.rng.uniform(9.0, 10.5)
        strut(kit, f"gate_pole{k}", (-3.0, y, 6.0), (-2.2, y + kit.rng.uniform(-0.6, 0.6), top), 0.16, "iron", sides=4)
    kit.box("gate_flag", (0.05, 1.2, 0.8), (-2.2, 0.0, 10.0), "accent", dent_by=0.08)


def inner(kit: Kit) -> None:
    """The inner gate: a wreck and container chicane in the curtain between two container stacks, shut doors on both X faces."""
    hd, hw = INNER_DEPTH / 2, INNER_WIDTH / 2
    for sign in (-1, 1):
        y = sign * (hw - 1.0)
        pillar = rect(-hd - 0.2, hd + 0.2, y - 1.0, y + 1.0)
        extrude(kit, f"inner_pillar{sign}", pillar, pillar, -SKIRT, INNER_HEIGHT, "dark")
        for i, e in enumerate(edges(pillar)):
            if i in (1, 3):
                skin(kit, f"inner_pillar{sign}_face{i}", e, 0.0, INNER_HEIGHT - 0.4)
    for k, (x, y0, y1) in enumerate(((-1.0, -3.0, 0.5), (1.0, -0.5, 3.0))):
        h = kit.rng.uniform(6.5, 8.0)
        kit.box(f"inner_slab{k}", (2.0, y1 - y0, h + SKIRT), (x, (y0 + y1) / 2, (h - SKIRT) / 2), "shade", rot=(0, 0, kit.rng.uniform(-0.04, 0.04)), dent_by=0.05)
        for r in range(3):
            kit.box(f"inner_slab{k}_sheet{r}", (2.05, (y1 - y0) / 3 - 0.1, h * 0.28), (x, y0 + (r + 0.5) * (y1 - y0) / 3, h * (0.2 + 0.3 * r)),
                    kit.rng.choice(("body", "iron", "trim", "accent")), rot=(kit.rng.uniform(-0.15, 0.15), 0, 0), dent_by=0.04)
    leaves(kit, "inner_door", -1.95, -1, 3.0, 5.5)
    leaves(kit, "inner_door_out", 1.95, 1, 3.0, 5.5)
    kit.box("inner_beam", (1.4, INNER_WIDTH - 3.4, 0.4), (0.0, 0.0, 10.2), "iron", rot=(0, 0, 0.05))


PIECES: dict[str, tuple[Callable[[Kit], None], float]] = {
    "wall": (wall, 34),
    "tower": (tower, 36),
    "gate": (gate, 46),
    "inner": (inner, 38),
}


def run(style: str, piece: str) -> None:
    """Builds fort_<style>_<piece> and exports it with an optional preview, from the script's command line."""
    if style not in STYLES:
        raise KeyError(f"unknown fort style {style!r}. Known: {sorted(STYLES)}")
    if piece not in PIECES:
        raise KeyError(f"unknown fort piece {piece!r}. Known: {sorted(PIECES)}")
    args = parse_args()
    kit = Kit(STYLES[style], SEEDS[(style, piece)])
    build, view = PIECES[piece]
    build(kit)
    kit.export(f"fort_{style}_{piece}", args, view_size=view)
