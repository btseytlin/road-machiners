"""Shared builders for the fortress pieces: wall, tower, gatehouse, star bastion point and inner gate.

Each fort_<style>_<piece>.py script calls run(style, piece). The style picks the palette and the face detail:
masonry has stone blocks and crenellations, ship has riveted hull plates, round towers and hazard bands, and scrap
has rusted patch sheets and jagged sheet teeth on top.

Sizes match the FORTRESS reference numbers in src/data/fortress.ts, with one tile = 4 m (AS4):
- wall: one straight section 8.0 m along X (FORTRESS.wallLength, 2 tiles), centered on the origin, 12 m tall,
  under 3 m thick and symmetric across Y, so either side may face out. The game stretches it along X only.
- tower: a 6 m footprint centered on the origin, 16 m tall.
- gate: the gatehouse, 10 m deep along X and 20 m wide along Y, 16 m tall. Its outer face is the plane X = 0,
  and it faces +X, so the origin is the center of the outer face at ground level and the body runs to X = -10.
  The double doors are shut and solid, so they are part of the collider.
- bastion: a star point. An arrowhead footprint with its tip at X = +6, shoulders at X = 0 and its back at X = -4,
  10 m wide, centered on the origin, 13.2 m tall. It reaches at most 6.4 m from the origin.
- inner: the inner gate in the curtain where a barbican meets it. 4 m deep along X and 10 m wide along Y, centered
  on the origin, 13 m tall, with shut doors on both X faces. It faces +X like the gatehouse.

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
from shapes import strut, taper  # noqa: E402

XY = tuple[float, float]

SKIRT = 1.2  # m below the ground point
WALL_LENGTH = 8.0  # FORTRESS.wallLength in meters
WALL_HEIGHT = 12.0
WALL_DEPTH = 2.8
TOWER_SIZE = 6.0
TOWER_HEIGHT = 16.0
GATE_DEPTH = 10.0
GATE_WIDTH = 20.0
GATE_HEIGHT = 16.0
BASTION_HEIGHT = 13.2
INNER_DEPTH = 4.0
INNER_WIDTH = 10.0
INNER_HEIGHT = 13.0

# Colors from src/render/palette.ts. Every style has the same roles, so a builder never names a style's colors.
# soot is darker than any palette color.
STYLES: dict[str, dict[str, int]] = {
    "masonry": {
        "body": 0xAD9976,  # pale sand stone between PAL.wall.top and PAL.rock.top (R3, R5, R7)
        "shade": 0x93805F,  # the same stone, a shade darker
        "dark": 0x7A6A50,  # the sloped base, the same stone darker still (R7)
        "light": 0x9A8A78,  # PAL.rock.top
        "trim": 0x6E6254,  # PAL.rock.side
        "door": 0x6A4A2A,  # PAL.trunk
        "door_dark": 0x3A2418,  # PAL.rust.dark
        "iron": 0x5A5A58,  # PAL.metal
        "accent": 0x8A3A2A,  # PAL.roof[2], banner red
        "soot": 0x1E1A18,
    },
    "ship": {
        "body": 0x8A8A84,  # PAL.metalLight
        "shade": 0x5A5A58,  # PAL.metal
        "dark": 0x3E4248,  # FACTION_COLORS.mercs.cabSide, the seams between plates
        "light": 0xB8B8B0,  # FACTION_COLORS.convoys.top
        "trim": 0x5E6038,  # FACTION_COLORS.nose.top, olive hull paint
        "door": 0x86867E,  # FACTION_COLORS.convoys.side
        "door_dark": 0x3E4248,  # FACTION_COLORS.mercs.cabSide
        "iron": 0x5A6068,  # FACTION_COLORS.mercs.cab
        "accent": 0xF0D060,  # PAL.select, hazard yellow
        "soot": 0x1E1A18,
    },
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

SEEDS = {
    ("masonry", "wall"): 101, ("masonry", "tower"): 102, ("masonry", "gate"): 103, ("masonry", "bastion"): 104, ("masonry", "inner"): 105,
    ("ship", "wall"): 201, ("ship", "tower"): 202, ("ship", "gate"): 203, ("ship", "bastion"): 204, ("ship", "inner"): 205,
    ("scrap", "wall"): 301, ("scrap", "tower"): 302, ("scrap", "gate"): 303, ("scrap", "bastion"): 304, ("scrap", "inner"): 305,
}


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


def skin(kit: Kit, style: str, name: str, edge: tuple[XY, XY], z0: float, z1: float) -> None:
    """Covers one vertical face from z0 to z1 with the style's surface detail."""
    length = frame(*edge)[0]
    z0 = max(z0, 0.0)
    if style == "masonry":
        # Ashlar courses: some blocks stand proud in a lighter or darker stone.
        course, row, z = 1.0, 0, z0
        while z + course <= z1 + 1e-6:
            u = kit.rng.uniform(-1.0, 0.0) if row % 2 else 0.0
            while u < length:
                blen = kit.rng.uniform(1.3, 2.4)
                a, b = max(u, 0.15), min(u + blen, length - 0.15)
                if b - a > 0.6 and kit.rng.random() < 0.4:
                    mat = kit.rng.choice(("light", "shade", "shade", "trim"))
                    plate(kit, f"{name}_block{row}_{int(u * 10)}", edge, (a + b) / 2, z + course / 2, b - a - 0.08, course - 0.08, 0.05, mat)
                u += blen
            z += course
            row += 1
    elif style == "ship":
        # Hull plates in bands, with the dark core showing in the seams.
        band, z, row = 2.2, z0, 0
        count = max(1, round(length / 2.6))
        w = length / count
        while z + 0.6 <= z1:
            h = min(band, z1 - z)
            for i in range(count):
                roll = kit.rng.random()
                mat = "trim" if roll < 0.12 else "shade" if roll < 0.35 else "body"
                plate(kit, f"{name}_plate{row}_{i}", edge, (i + 0.5) * w, z + h / 2, w - 0.16, h - 0.16, 0.05, mat)
            z += band
            row += 1
    elif style == "scrap":
        # Patch sheets of every color on a jittered grid, tilted and battered, welded over a rusty core.
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
    else:
        raise KeyError(f"unknown fort style {style!r}")


def band(kit: Kit, style: str, name: str, edge: tuple[XY, XY], z: float) -> None:
    """A horizontal band across a face just under the top: a string course, a hazard stripe or a welded rail."""
    length = frame(*edge)[0]
    if style == "masonry":
        plate(kit, f"{name}_course", edge, length / 2, z, length, 0.3, 0.09, "trim")
    elif style == "ship":
        plate(kit, f"{name}_hazard", edge, length / 2, z, length, 0.7, 0.07, "soot")
        count = max(2, int(length / 1.1))
        for i in range(count):
            plate(kit, f"{name}_chevron{i}", edge, (i + 0.5) * length / count, z, 0.42, 0.42, 0.09, "accent", tilt=math.pi / 4)
    elif style == "scrap":
        plate(kit, f"{name}_rail", edge, length / 2, z, length, 0.22, 0.08, "iron", tilt=kit.rng.uniform(-0.02, 0.02))
    else:
        raise KeyError(f"unknown fort style {style!r}")


def crown(kit: Kit, style: str, name: str, edge: tuple[XY, XY], z: float, top: float) -> None:
    """The top of one face from z to top, standing just inside the face line: merlons, a railed coaming or sheet teeth."""
    length = frame(*edge)[0]
    if style == "masonry":
        breast = z + (top - z) * 0.4
        plate(kit, f"{name}_parapet", edge, length / 2, (z + breast) / 2, length, breast - z, 0.5, "body", depth=0.25)
        count = max(1, round(length / 2.0))
        step = length / count
        for i in range(count):
            plate(kit, f"{name}_merlon{i}", edge, (i + 0.5) * step, (breast + top) / 2, min(1.1, step * 0.6), top - breast, 0.5, "body", depth=0.25)
            plate(kit, f"{name}_cap{i}", edge, (i + 0.5) * step, top - 0.08, min(1.1, step * 0.6) + 0.1, 0.16, 0.6, "light", depth=0.25)
    elif style == "ship":
        coaming = z + (top - z) * 0.4
        plate(kit, f"{name}_coaming", edge, length / 2, (z + coaming) / 2, length, coaming - z, 0.6, "light", depth=0.3)
        count = max(2, round(length / 2.0) + 1)
        for i in range(count):
            u = 0.15 + i * (length - 0.3) / (count - 1)
            plate(kit, f"{name}_post{i}", edge, u, (coaming + top) / 2, 0.14, top - coaming, 0.14, "shade", depth=0.3)
        plate(kit, f"{name}_rail", edge, length / 2, top - 0.08, length, 0.16, 0.16, "accent", depth=0.3)
        plate(kit, f"{name}_rail_mid", edge, length / 2, (coaming + top) / 2, length, 0.1, 0.1, "shade", depth=0.3)
    elif style == "scrap":
        u = 0.0
        i = 0
        while u < length - 0.3:
            w = min(kit.rng.uniform(0.5, 1.3), length - u)
            h = kit.rng.uniform((top - z) * 0.55, top - z + 0.15)
            mat = kit.rng.choice(("body", "shade", "iron", "body", "dark"))
            plate(kit, f"{name}_tooth{i}", edge, u + w / 2, z + h / 2, w, h, 0.1, mat, tilt=kit.rng.uniform(-0.3, 0.3), dent=0.05, depth=0.2)
            u += w * kit.rng.uniform(0.75, 1.0)
            i += 1
        # The last tooth reaches the full height, so every crown tops out at `top`.
        plate(kit, f"{name}_tooth_top", edge, length * kit.rng.uniform(0.3, 0.7), (z + top) / 2, 0.7, top - z, 0.1, "iron", depth=0.2)
    else:
        raise KeyError(f"unknown fort style {style!r}")


def slits(kit: Kit, style: str, name: str, edge: tuple[XY, XY], heights: list[float]) -> None:
    """Arrow slits, portholes or gun ports along a face at the given heights."""
    length = frame(*edge)[0]
    count = max(1, round(length / 4.0))
    for row, z in enumerate(heights):
        for i in range(count):
            u = (i + 0.5) * length / count
            if style == "masonry":
                plate(kit, f"{name}_slit{row}_{i}", edge, u, z, 0.3, 1.5, 0.07, "soot")
            elif style == "ship":
                plate(kit, f"{name}_port_rim{row}_{i}", edge, u, z, 0.9, 0.9, 0.07, "shade", tilt=math.pi / 4)
                plate(kit, f"{name}_port{row}_{i}", edge, u, z, 0.55, 0.55, 0.1, "soot", tilt=math.pi / 4)
            elif style == "scrap":
                plate(kit, f"{name}_port{row}_{i}", edge, u + kit.rng.uniform(-0.4, 0.4), z, 1.1, 0.35, 0.1, "soot", tilt=kit.rng.uniform(-0.1, 0.1))
            else:
                raise KeyError(f"unknown fort style {style!r}")


def block(kit: Kit, style: str, name: str, poly: list[XY], z1: float, top: float, faces: set[int] | None = None, ports: list[float] | None = None) -> None:
    """A solid with the style's plinth, face detail, top band and crown. poly is counterclockwise and convex.

    The core rises from the skirt to z1 and the crown from z1 to top. faces lists the edge indices that get detail,
    or None for all of them.
    """
    shown = [(i, e) for i, e in enumerate(edges(poly)) if faces is None or i in faces]
    if style == "masonry":
        # A battered plinth: the core's footprint at the top, flaring out 0.3 m at the ground.
        extrude(kit, f"{name}_core", poly, poly, -SKIRT, z1, "body")
        foot = 2.0
        extrude(kit, f"{name}_plinth", _outset(poly, 0.3, faces), poly, -SKIRT, foot, "dark")
        detail_from = foot
    elif style == "ship":
        extrude(kit, f"{name}_core", poly, poly, -SKIRT, z1, "dark")
        foot = 0.9
        extrude(kit, f"{name}_footing", _outset(poly, 0.25, faces), _outset(poly, 0.25, faces), -SKIRT, foot, "shade")
        detail_from = foot
    elif style == "scrap":
        extrude(kit, f"{name}_core", poly, poly, -SKIRT, z1, "shade")
        detail_from = 0.0
    else:
        raise KeyError(f"unknown fort style {style!r}")
    for i, e in shown:
        skin(kit, style, f"{name}_face{i}", e, detail_from, z1 - 1.0)
        band(kit, style, f"{name}_band{i}", e, z1 - 0.5)
        if ports:
            slits(kit, style, f"{name}_face{i}", e, ports)
    for i, e in shown:
        crown(kit, style, f"{name}_crown{i}", e, z1, top)
    if style == "scrap":
        # A deck over the core, so the crown teeth stand on something.
        extrude(kit, f"{name}_deck", inset(poly, 0.05), inset(poly, 0.05), z1 - 0.1, z1 + 0.15, "trim")


def _outset(poly: list[XY], d: float, faces: set[int] | None) -> list[XY]:
    """Moves the listed edges d meters outward and leaves the others in place."""
    if faces is None:
        return inset(poly, -d)
    shifted = []
    for i, (p0, p1) in enumerate(edges(poly)):
        _, t, n, _ = frame(p0, p1)
        k = d if i in faces else 0.0
        shifted.append(((p0[0] + n[0] * k, p0[1] + n[1] * k), t))
    out = []
    for i in range(len(shifted)):
        (a, ta), (b, tb) = shifted[i - 1], shifted[i]
        cross = ta[0] * tb[1] - ta[1] * tb[0]
        s = ((b[0] - a[0]) * tb[1] - (b[1] - a[1]) * tb[0]) / cross
        out.append((a[0] + ta[0] * s, a[1] + ta[1] * s))
    return out


# --- Doors ----------------------------------------------------------------------------------------------------


def _arch(kit: Kit, name: str, edge: tuple[XY, XY], width: float, spring: float, apex: float) -> None:
    """A pointed arch over shut doors: stepped door fill and two leaning voussoir bands, springing at `spring` (R5)."""
    mid = frame(*edge)[0] / 2
    half = width / 2
    rise = apex - spring
    steps = 5
    for k in range(steps):
        z0 = spring + k * rise / steps
        w = width * (1 - (k + 0.5) / steps)
        plate(kit, f"{name}_fill{k}", edge, mid, z0 + rise / steps / 2, w, rise / steps + 0.02, 0.2, "door")
    run, lean = half + 0.3, math.atan2(rise + 0.3, half + 0.3)
    length = math.hypot(run, rise + 0.3)
    for side, sign in (("l", -1), ("r", 1)):
        plate(kit, f"{name}_voussoir_{side}", edge, mid + sign * run / 2, spring + (rise + 0.3) / 2, length, 0.7, 0.28, "trim", tilt=sign * lean)


def doors(kit: Kit, style: str, name: str, edge: tuple[XY, XY], width: float, height: float, apex: float = 0.0) -> None:
    """Shut double doors in a frame, centered on a face. They stand proud of the face, so they read as a gate.

    A masonry apex over height closes the opening with a pointed arch up to the apex.
    """
    length = frame(*edge)[0]
    mid = length / 2
    arch = style == "masonry" and apex > height
    plate(kit, f"{name}_frame", edge, mid, height / 2 + 0.3, width + 1.2, height + 0.6, 0.12, "dark" if style != "scrap" else "iron")
    if arch:
        _arch(kit, name, edge, width, height, apex)
    else:
        plate(kit, f"{name}_lintel", edge, mid, height + 0.5, width + 1.6, 0.8, 0.2, "trim" if style == "masonry" else "shade")
    leaf = width / 2 - 0.05
    for side, sign in (("l", -1), ("r", 1)):
        u = mid + sign * (leaf / 2 + 0.05)
        if style == "masonry":
            plate(kit, f"{name}_{side}", edge, u, height / 2, leaf, height, 0.2, "door")
            for k in range(3):
                plate(kit, f"{name}_{side}_plank{k}", edge, u + (k - 1) * leaf / 3, height / 2, 0.08, height - 0.2, 0.23, "door_dark")
            for k, z in enumerate((height * 0.18, height * 0.5, height * 0.82)):
                plate(kit, f"{name}_{side}_strap{k}", edge, u, z, leaf - 0.1, 0.3, 0.26, "iron")
        elif style == "ship":
            plate(kit, f"{name}_{side}", edge, u, height / 2, leaf, height, 0.2, "door")
            for k in range(4):
                plate(kit, f"{name}_{side}_rib{k}", edge, u, height * (k + 0.5) / 4, leaf - 0.3, 0.35, 0.24, "shade")
            plate(kit, f"{name}_{side}_kick", edge, u, 0.45, leaf, 0.9, 0.25, "soot")
            for k in range(int(leaf / 0.9)):
                plate(kit, f"{name}_{side}_chev{k}", edge, u - leaf / 2 + (k + 0.5) * leaf / int(leaf / 0.9), 0.45, 0.45, 0.45, 0.27, "accent", tilt=math.pi / 4)
        elif style == "scrap":
            plate(kit, f"{name}_{side}", edge, u, height / 2, leaf, height, 0.2, "door", dent=0.05)
            for k in range(5):
                w = kit.rng.uniform(1.0, leaf * 0.8)
                h = kit.rng.uniform(1.0, 2.4)
                plate(kit, f"{name}_{side}_patch{k}", edge, u + kit.rng.uniform(-(leaf - w) / 2, (leaf - w) / 2), kit.rng.uniform(h / 2, height - h / 2), w, h, 0.24,
                      kit.rng.choice(("body", "shade", "accent", "trim")), tilt=kit.rng.uniform(-0.2, 0.2), dent=0.05)
            for k in range(3):
                plate(kit, f"{name}_{side}_brace{k}", edge, u, height * (k + 0.5) / 3, leaf * 1.1, 0.25, 0.27, "dark", tilt=0.5 * sign * (1 if k % 2 else -1))
        else:
            raise KeyError(f"unknown fort style {style!r}")
    plate(kit, f"{name}_seam", edge, mid, height / 2, 0.12, height, 0.24, "soot")


# --- Pieces ---------------------------------------------------------------------------------------------------


def wall(kit: Kit, style: str) -> None:
    """One 8 m wall section along X, 12 m tall, detailed on both long faces."""
    half_l, half_d = WALL_LENGTH / 2, WALL_DEPTH / 2
    poly = rect(-half_l, half_l, -half_d, half_d)
    z1 = 10.6
    block(kit, style, "wall", poly, z1, WALL_HEIGHT, faces={0, 2})
    if style == "ship":
        # Ribs where hull sections were welded together.
        for x in (-half_l + 0.3, 0.0, half_l - 0.3):
            for sign in (-1, 1):
                kit.box("wall_rib", (0.4, 0.1, z1 - 1.0), (x, sign * (half_d + 0.03), (z1 - 1.0) / 2), "shade")
    elif style == "scrap":
        # Two tiers of mesh baskets at the base, rust plate above and a wire coil along the top (R6).
        tier = 1.4
        for sign in (-1, 1):
            edge = edges(poly)[0 if sign < 0 else 2]
            for t in range(2):
                z = tier * (t + 0.5)
                plate(kit, f"wall_basket{sign}_{t}", edge, WALL_LENGTH / 2, z, WALL_LENGTH - 0.1, tier - 0.1, 0.1, "trim", tilt=0.0)
                for c in range(int(WALL_LENGTH / 1.0) + 1):
                    plate(kit, f"wall_mesh{sign}_{t}_{c}", edge, c * 1.0 + 0.05, z, 0.1, tier, 0.14, "iron")
                plate(kit, f"wall_frame{sign}_{t}", edge, WALL_LENGTH / 2, tier * (t + 1) - 0.06, WALL_LENGTH, 0.12, 0.15, "iron")
        for i in range(10):
            kit.cylinder(f"wall_coil{i}", 0.4, 0.14, (-half_l + 0.4 + i * 0.8, 0.0, WALL_HEIGHT - 0.4), "iron", rot=(0, math.pi / 2, 0), vertices=8)
        # Old tires half buried along both feet.
        for sign in (-1, 1):
            for i in range(3):
                x = kit.rng.uniform(-half_l + 1.0, half_l - 1.0)
                kit.cylinder(f"wall_tire{sign}_{i}", 0.6, 0.35, (x, sign * (half_d - 0.05), 0.3), "door_dark", rot=(math.pi / 2, 0, 0), vertices=8)


def _masonry_drum(kit: Kit) -> None:
    """A round stone drum 6 m across that projects past the curtain face, with slit windows and a crenellated top (R3, R4).

    Its height over its width is 16 / 6 = 2.7, taller than R4's 2.3 because of the 16 m rule.
    """
    r = 2.7
    kit.cylinder("tower_core", r, 12.4 + SKIRT, (0, 0, (12.4 - SKIRT) / 2), "body", vertices=16)
    kit.cylinder("tower_plinth", r + 0.25, 2.0 + SKIRT, (0, 0, (2.0 - SKIRT) / 2), "dark", vertices=16)
    for k, z in enumerate((4.0, 8.0)):
        kit.cylinder(f"tower_course{k}", r + 0.07, 0.3, (0, 0, z), "trim", vertices=16)
    for k in range(8):
        a = k * math.tau / 8 + math.pi / 8
        for z in (5.5, 9.5):
            kit.box(f"tower_slit{k}_{z}", (0.12, 0.3, 1.5), (math.cos(a) * (r + 0.05), math.sin(a) * (r + 0.05), z), "soot", rot=(0, 0, a + math.pi / 2))
    # A corbel ring carries the gallery out to the full footprint.
    kit.cylinder("tower_corbels", r + 0.1, 0.8, (0, 0, 12.4), "trim", vertices=16)
    kit.cylinder("tower_gallery", 2.9, 1.2, (0, 0, 12.4 + 0.6), "shade", vertices=16)
    kit.cylinder("tower_parapet", 2.85, 1.2, (0, 0, 13.6 + 0.6), "body", vertices=16)
    kit.cylinder("tower_floor", 2.5, 0.3, (0, 0, 14.0), "dark", vertices=16)
    for k in range(10):
        a = k * math.tau / 10
        x, y = math.cos(a) * 2.75, math.sin(a) * 2.75
        kit.box(f"tower_merlon{k}", (0.9, 0.5, TOWER_HEIGHT - 14.8), (x, y, (14.8 + TOWER_HEIGHT) / 2), "body", rot=(0, 0, a + math.pi / 2))
        kit.box(f"tower_cap{k}", (1.0, 0.6, 0.16), (x, y, TOWER_HEIGHT - 0.08), "light", rot=(0, 0, a + math.pi / 2))
    strut(kit, "tower_pole", (0, 0, 14.4), (0, 0, TOWER_HEIGHT + 2.4), 0.14, "iron", sides=6)
    kit.box("tower_banner", (0.06, 1.4, 1.0), (0, 0.75, TOWER_HEIGHT + 1.7), "accent")


def tower(kit: Kit, style: str) -> None:
    """A tower on a 6 m footprint, 16 m tall: square stone, a round ship turret or stacked scrap boxes."""
    half = TOWER_SIZE / 2
    if style == "masonry":
        _masonry_drum(kit)
    elif style == "ship":
        _ship_turret(kit, "tower", (0.0, 0.0), 2.8, 13.0)
    elif style == "scrap":
        _scrap_stack(kit, "tower", (0.0, 0.0), 5.6, 5.6, dressed=True)
    else:
        raise KeyError(f"unknown fort style {style!r}")


def _ship_turret(kit: Kit, name: str, at: XY, radius: float, z1: float) -> None:
    """A round plated turret with porthole rings, a gallery and a domed cabin topping out at 16 m."""
    x, y = at
    kit.cylinder(f"{name}_core", radius, z1 + SKIRT, (x, y, (z1 - SKIRT) / 2), "dark", vertices=12)
    kit.cylinder(f"{name}_footing", radius + 0.2, 0.9 + SKIRT, (x, y, (0.9 - SKIRT) / 2), "shade", vertices=12)
    for k, z in enumerate((2.0, 4.4, 6.8, 9.2)):
        kit.cylinder(f"{name}_plates{k}", radius + 0.05, 2.2, (x, y, z + 0.1), "body" if k % 2 else "shade", vertices=12)
    kit.cylinder(f"{name}_paint", radius + 0.06, 0.8, (x, y, 10.6), "trim", vertices=12)
    kit.cylinder(f"{name}_hazard", radius + 0.07, 0.5, (x, y, 11.6), "accent", vertices=12)
    for k in range(6):
        a = k * math.tau / 6 + math.pi / 6
        for z in (4.5, 8.8):
            kit.box(f"{name}_port{k}_{z}", (0.2, 0.6, 0.6), (x + math.cos(a) * (radius + 0.08), y + math.sin(a) * (radius + 0.08), z), "soot", rot=(math.pi / 4, 0, a))
    kit.cylinder(f"{name}_gallery", radius + 0.2, 0.6, (x, y, z1 + 0.3), "light", vertices=12)
    kit.cylinder(f"{name}_cabin", radius - 0.6, 1.8, (x, y, z1 + 1.5), "body", vertices=12)
    kit.cylinder(f"{name}_windows", radius - 0.55, 0.5, (x, y, z1 + 1.6), "soot", vertices=12)
    dome = kit.cylinder(f"{name}_dome", radius - 0.6, 0.6, (x, y, z1 + 2.7), "shade", vertices=12)
    taper(dome, 0.45)
    strut(kit, f"{name}_mast", (x, y, z1 + 3.0), (x, y, TOWER_HEIGHT + 2.0), 0.12, "iron", sides=6)
    kit.box(f"{name}_beacon", (0.3, 0.3, 0.3), (x, y, TOWER_HEIGHT + 2.0), "accent")


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
            skin(kit, "scrap", f"{name}_box{k}_face{i}", e, z0, z1)
            # Container ribs.
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
                    plate(kit, f"{name}_bag{i}_{row}_{b}", e, (b + 0.5 + (0.25 if row % 2 else 0.0)) * length / n % length, 0.18 + row * 0.35, length / n - 0.06, 0.32, 0.1, "trim" if (b + row) % 3 else "light", dent=0.03, depth=0.0)
            top_poly = rect(x - sx * 0.475, x + sx * 0.475, y - sy * 0.475, y + sy * 0.475)
            te = edges(top_poly)[i]
            for k in range(int(frame(*te)[0] / 1.2)):
                u = (k + 0.5) * 1.2
                plate(kit, f"{name}_net{i}_{k}a", te, u, 11.4, 0.07, 3.2, 0.05, "dark", tilt=0.6)
                plate(kit, f"{name}_net{i}_{k}b", te, u, 11.4, 0.07, 3.2, 0.05, "dark", tilt=-0.6)
    deck = rect(x - sx / 2 - 0.1, x + sx / 2 + 0.1, y - sy / 2 - 0.1, y + sy / 2 + 0.1)
    extrude(kit, f"{name}_deck", deck, deck, 13.0, 13.3, "trim")
    for i, e in enumerate(edges(deck)):
        crown(kit, "scrap", f"{name}_crown{i}", e, 13.3, TOWER_HEIGHT - 0.6)
    kit.box(f"{name}_roof", (sx * 0.8, sy * 0.8, 0.12), (x, y, TOWER_HEIGHT - 0.3), "body", rot=(0, math.radians(8), 0), dent_by=0.05)
    for px, py in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        strut(kit, f"{name}_post{px}{py}", (x + px * sx * 0.35, y + py * sy * 0.35, 13.3), (x + px * sx * 0.35, y + py * sy * 0.35, TOWER_HEIGHT - 0.3 - px * 0.3), 0.15, "iron")
    strut(kit, f"{name}_spike", (x - sx * 0.3, y + sy * 0.3, 13.3), (x - sx * 0.3, y + sy * 0.3, TOWER_HEIGHT + 1.5), 0.12, "iron", sides=4)
    kit.box(f"{name}_flag", (0.05, 1.2, 0.8), (x - sx * 0.3, y + sy * 0.3 + 0.62, TOWER_HEIGHT + 1.0), "accent", dent_by=0.08)


def gate(kit: Kit, style: str) -> None:
    """The gatehouse: two towers flank a gate block with shut double doors in the outer face at X = 0."""
    d, hw = GATE_DEPTH, GATE_WIDTH / 2
    tw = 6.0  # flanking tower width along Y
    front = 0.0
    recess = 1.8 if style == "masonry" else 0.8  # the doors sit this far behind the tower fronts. Masonry towers stand 1 m prouder (R4, R5).
    mid = rect(-d + 0.5, front - recess, -(hw - tw) - 0.2, hw - tw + 0.2)
    block(kit, style, "gate_mid", mid, 12.0, 13.6, faces={1, 3})
    # The front face of the gate block (edge 1 is the +X face of a counterclockwise rect).
    face = edges(mid)[1]
    # A pointed arch up to half the gate's height (R5).
    doors(kit, style, "gate_door", face, 6.0, 5.5 if style == "masonry" else 8.0, apex=GATE_HEIGHT / 2)
    if style == "masonry":
        # A corbel band under the parapet over the gate (R5).
        fl = frame(*face)[0]
        for k in range(int(fl / 1.0)):
            plate(kit, f"gate_corbel{k}", face, (k + 0.5) * fl / int(fl / 1.0), 10.6, 0.5, 0.9, 0.3, "trim")
        plate(kit, "gate_crest", face, fl / 2, 9.4, 1.2, 1.2, 0.15, "accent")
    elif style == "ship":
        plate(kit, "gate_sign", face, frame(*face)[0] / 2, 10.3, 5.0, 1.1, 0.15, "trim")
        plate(kit, "gate_lamp_l", face, frame(*face)[0] / 2 - 3.6, 9.0, 0.5, 0.5, 0.25, "accent")
        plate(kit, "gate_lamp_r", face, frame(*face)[0] / 2 + 3.6, 9.0, 0.5, 0.5, 0.25, "accent")
    elif style == "scrap":
        for k in range(5):
            u = frame(*face)[0] / 2 + (k - 2) * 1.4
            plate(kit, f"gate_spike{k}", face, u, 10.0, 0.18, 2.0, 0.3, "iron", tilt=(k - 2) * 0.25)
    for sign in (-1, 1):
        y0, y1 = (hw - tw, hw) if sign > 0 else (-hw, -(hw - tw))
        if style == "ship":
            # A round-fronted turret: a plated box behind a turret drum whose front touches X = 0.
            r = tw / 2
            cy = (y0 + y1) / 2
            back = rect(-d, -r, y0, y1)
            block(kit, style, f"gate_tower{sign}", back, 13.0, 14.0, faces={0, 2, 3})
            _ship_turret(kit, f"gate_turret{sign}", (-r, cy), r - 0.05, 13.0)
        elif style == "scrap":
            _scrap_stack(kit, f"gate_tower{sign}", (-d / 2, (y0 + y1) / 2), d - 0.4, tw - 0.4)
        else:
            body = rect(-d, front, y0, y1)
            block(kit, style, f"gate_tower{sign}", body, 13.4, GATE_HEIGHT, ports=[5.5, 10.0])


def bastion(kit: Kit, style: str) -> None:
    """A star bastion point: an arrowhead with its tip at X = +6, crowned on every face."""
    poly = [(6.0, 0.0), (0.0, 5.0), (-4.0, 5.0), (-4.0, -5.0), (0.0, -5.0)]
    block(kit, style, "bastion", poly, 11.2, BASTION_HEIGHT, ports=[6.0] if style != "scrap" else [7.0])
    if style == "masonry":
        # A sentry box on the tip.
        kit.cylinder("bastion_sentry", 0.7, 2.2, (4.4, 0.0, 12.3), "shade", vertices=8)
        cone = kit.cylinder("bastion_sentry_roof", 0.9, 0.9, (4.4, 0.0, 13.85), "trim", vertices=8)
        taper(cone, 0.1)
    elif style == "ship":
        kit.cylinder("bastion_mount", 1.0, 0.8, (2.4, 0.0, 11.6), "shade", vertices=10)
        kit.box("bastion_gun", (3.2, 0.4, 0.4), (3.8, 0.0, 12.2), "iron")
    elif style == "scrap":
        for k in range(3):
            strut(kit, f"bastion_spike{k}", (4.4 - k * 0.8, (k - 1) * 0.6, 11.2), (5.6 - k * 0.5, (k - 1) * 0.9, BASTION_HEIGHT + 0.8), 0.14, "iron", sides=4)


def inner(kit: Kit, style: str) -> None:
    """The inner gate: a gate block in the curtain with shut doors on both X faces."""
    hd, hw = INNER_DEPTH / 2, INNER_WIDTH / 2
    # The end pillars cover the block's ends, so the block stops short of them.
    poly = rect(-hd, hd, -hw + 0.6, hw - 0.6)
    block(kit, style, "inner", poly, 11.4, INNER_HEIGHT, faces={1, 3})
    for i in (1, 3):
        doors(kit, style, f"inner_door{i}", edges(poly)[i], 4.4, 6.5)
    for sign in (-1, 1):
        # Short end pillars stand a little higher, so the gate reads over the curtain.
        y = sign * (hw - 0.9)
        pillar = rect(-hd - 0.2, hd + 0.2, y - 0.9, y + 0.9)
        if style == "ship":
            kit.cylinder(f"inner_pillar{sign}", 1.0, INNER_HEIGHT + SKIRT, (0.0, y, (INNER_HEIGHT - SKIRT) / 2), "shade", vertices=10)
            kit.cylinder(f"inner_pillar_hazard{sign}", 1.05, 0.5, (0.0, y, INNER_HEIGHT - 1.0), "accent", vertices=10)
        else:
            extrude(kit, f"inner_pillar{sign}", pillar, pillar, -SKIRT, INNER_HEIGHT, "shade" if style == "masonry" else "dark")
            for i, e in enumerate(edges(pillar)):
                if i in (1, 3):
                    skin(kit, style, f"inner_pillar{sign}_face{i}", e, 0.0, INNER_HEIGHT - 0.4)


PIECES: dict[str, tuple[Callable[[Kit, str], None], float]] = {
    "wall": (wall, 34),
    "tower": (tower, 36),
    "gate": (gate, 46),
    "bastion": (bastion, 38),
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
    build(kit, style)
    kit.export(f"fort_{style}_{piece}", args, view_size=view)
