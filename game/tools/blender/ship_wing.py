"""Broken Wing landmark: the wing's torn root, bent up and over the road as a tall plated hoop.

Built at scale 1 for the baked shipWing prop. The origin is on the road's center line at the ground under the hoop.
The model's X runs along the road and Y across it. The camera sees the hoop from +X, -Y.
- The band is lofted along a lopsided arc in the YZ plane, 2.5 m thick and 11 m wide along the road at the near foot,
  8.5 m at the torn head. Its near foot stands at Y -17.5 and bows out before it climbs. Its top is 30 m up and leans
  toward +Y, and its torn head hangs past the far leg, a narrower column at Y +17.5. Dark ribs wrap it, and a dark
  lattice runs 3.2 m inside its curve. The whole hoop turns by TURN about Z, so the far foot stands 6.7 m further
  along +X, as in the concept view. The Y values above are before that turn.
- Feet span: 35 m between the foot centers. Height: 30.8 m. Bake radius: 26.5 m (6.6 tiles). Every vertex lies within
  25.1 m of the origin, and every collision box corner in src/data/prop-shapes.json within 26.5 m.
- Every box over |Y| <= 12, the road, starts above 3.8 m (truckClearance + 1 m). Only the feet, their debris and
  sand reach the ground, all at |Y| >= 13.
Run: blender --background --python tools/blender/ship_wing.py -- public/models/ship_wing.glb [tmp/ship_wing.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from mathutils import Matrix  # noqa: E402
from shapes import loft, mound, strut, taper  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "sand": 0xC9A878,  # PAL.sand[0]
    "soot": 0x1E1A18,
}
SEED = 114

BAKE_RADIUS = 26.5  # m, the reach of every part and collision box from the origin, for MODEL_RADIUS.ship_wing
THICK = 2.5  # m, the band's radial thickness
# The band's center line in the YZ plane, near foot to torn head, read from the concept view: the near leg bows out,
# the top leans toward the far leg, and the head hangs past it.
ARC = [
    (-17.5, -1.0),
    (-19.8, 4.0),
    (-20.8, 9.0),
    (-20.2, 14.5),
    (-17.8, 19.5),
    (-13.8, 23.8),
    (-8.5, 26.9),
    (-2.5, 28.7),
    (4.0, 29.3),
    (10.0, 29.0),
    (15.0, 28.0),
    (19.0, 26.2),
    (21.5, 23.5),
    (22.5, 20.5),
    (23.0, 17.5),
]
WIDTH_FOOT, WIDTH_HEAD = 11.0, 8.5  # m, the band's width along X at the near foot and at the head
LEG_Y = 17.5  # the far leg's center
LEG_SIZE = (5.0, 3.2)  # m, the far leg's X and Y extent at its top; its base flares wider
LEG_TOP = 26.5  # m, where the far leg meets the band's underside
LATTICE = 3.2  # m, how far inside the band's inner face the lattice ring runs
SKIN = 0.25  # m, plate thickness
TURN = math.radians(-11)  # about Z: the far foot stands 6.7 m further along +X than the near foot, as in the concept view
ROAD_HALF = 12.0  # m, half the road band that must stay open under the hoop
CLEAR = 3.8  # m, truckClearance + 1 m: the lowest a part over the road may start


def tangent_at(k: float) -> float:
    """The arc's direction at station k (fractional), as the angle from +Y toward +Z."""
    i = min(int(k), len(ARC) - 2)
    (y0, z0), (y1, z1) = ARC[i], ARC[i + 1]
    return math.atan2(z1 - z0, y1 - y0)


def point_at(k: float) -> tuple[float, float]:
    """The center line point at fractional station k."""
    i = min(int(k), len(ARC) - 2)
    t = k - i
    (y0, z0), (y1, z1) = ARC[i], ARC[i + 1]
    return (y0 + t * (y1 - y0), z0 + t * (z1 - z0))


def normal_at(k: float) -> tuple[float, float]:
    """The outward unit normal of the arc at station k, in YZ. Whole stations average their two segments."""
    if float(k).is_integer() and 0 < k < len(ARC) - 1:
        a, b = ARC[int(k) - 1], ARC[int(k) + 1]
        dy, dz = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dy, dz)
        return (-dz / n, dy / n)
    th = tangent_at(k)
    return (-math.sin(th), math.cos(th))


def width_at(k: float) -> float:
    return WIDTH_FOOT + (WIDTH_HEAD - WIDTH_FOOT) * k / (len(ARC) - 1)


def off(k: float, radial: float, x: float = 0.0) -> tuple[float, float, float]:
    """The point at station k, radial m off the center line (+ is outward), at x along the road."""
    y, z = point_at(k)
    ny, nz = normal_at(k)
    return (x, y + ny * radial, z + nz * radial)


def band_ring(k: int, out: float, inn: float, half_w: float) -> list[tuple[float, float, float]]:
    """The four corners of the band's section at station k, from `inn` to `out` m off the center line."""
    return [off(k, out, half_w), off(k, out, -half_w), off(k, inn, -half_w), off(k, inn, half_w)]


def plate(kit: Kit, name: str, k: float, radial: float, x: float, size: tuple[float, float, float], mat: str, tilt: float = 0.0, dent_by: float = 0.04) -> None:
    """A box laid on the band at station k: size is (along X, along the arc, across the arc)."""
    kit.box(name, size, off(k, radial, x), mat, rot=(tangent_at(k) + tilt, 0, 0), dent_by=dent_by)


def band(kit: Kit) -> None:
    """The band: a dark lofted core, light plated outer skin, darker inner skin and two plate rows on each side face,
    with the core showing as a dark seam between them, as in the concept's side view."""
    rings = [band_ring(k, THICK / 2, -THICK / 2, width_at(k) / 2 - 0.3) for k in range(len(ARC))]
    loft(kit, "band_core", rings, "soot")
    steps = (len(ARC) - 1) * 2
    for s in range(steps):
        k = (s + 0.5) / 2
        y, z = point_at(k)
        length = math.dist(point_at(s / 2), point_at((s + 1) / 2)) + 0.15
        w = width_at(k)
        cols = 3
        for c in range(cols):
            x = -w / 2 + (c + 0.5) * w / cols
            roll = kit.rng.random()
            mat = "rust" if roll < 0.06 else "metal" if roll < 0.14 else "metal_light"
            plate(kit, f"skin_out{s}_{c}", k, THICK / 2 + SKIN / 2, x, (w / cols - 0.12, length - 0.12, SKIN), mat, tilt=kit.rng.uniform(-0.03, 0.03))
        plate(kit, f"skin_in{s}", k, -THICK / 2 - SKIN / 2, 0.0, (w - 0.6, length - 0.2, SKIN), "metal" if s % 3 else "rust_side")
        for side in (-1, 1):
            x = side * (w / 2 - 0.05)
            plate(kit, f"side_out{s}{side}", k, 0.6, x, (0.3, length - 0.1, 1.3), "metal_light")
            plate(kit, f"side_in{s}{side}", k, -0.95, x, (0.3, length - 0.1, 0.7), "metal")
        # A rust patch on some outer plates.
        if kit.rng.random() < 0.25:
            plate(kit, f"patch{s}", k, THICK / 2 + SKIN + 0.04, kit.rng.uniform(-w / 3, w / 3), (kit.rng.uniform(1.0, 2.0), kit.rng.uniform(1.0, 2.0), 0.08), "rust")


def ribs(kit: Kit) -> None:
    """Dark frames wrapping the band at every station, standing proud of the plating, so its edges read ribbed."""
    for k in range(1, len(ARC) - 1):
        plate(kit, f"rib{k}", k, -0.3, 0.0, (width_at(k) + 1.0, 0.4, THICK + 1.0), "rust_dark", dent_by=0.04)


def lattice(kit: Kit) -> None:
    """Two dark chords inside the curve, LATTICE m in from the band, with cross bars and diagonals back to the band."""
    last = len(ARC) - 4  # the lattice stops before the far leg
    inner = -THICK / 2 - LATTICE
    for k in range(1, last + 1):  # from station 1, so the lattice stays off the ground by the road
        hw = width_at(k) / 2 - 1.2
        for side in (-1, 1):
            if k < last:
                strut(kit, f"chord{k}{side}", off(k, inner, side * hw), off(k + 1, inner, side * hw), 0.6, "soot")
            strut(kit, f"post{k}{side}", off(k, inner, side * hw), off(k, -THICK / 2, side * hw), 0.45, "soot")
            if k < last:
                strut(kit, f"diag{k}{side}", off(k, inner, side * hw), off(k + 1, -THICK / 2, side * hw), 0.3, "soot")
        strut(kit, f"bar{k}", off(k, inner, -hw), off(k, inner, hw), 0.35, "soot")
        if k < last:
            strut(kit, f"cross{k}", off(k, inner, -hw), off(k + 1, inner, hw), 0.25, "soot")


def far_leg(kit: Kit) -> None:
    """The far leg: a dark column under the band's far end, with plated strips, X braces in its gaps and a flared
    base."""
    lx, ly = LEG_SIZE
    core = kit.box("leg_core", (lx - 0.6, ly - 0.6, LEG_TOP + 1.0), (0.0, LEG_Y, (LEG_TOP - 1.0) / 2), "soot")
    taper(core, 1.0, 1.45)
    z = 0.0
    while z < LEG_TOP - 1.0:
        h = min(kit.rng.uniform(2.5, 3.8), LEG_TOP - z)
        widen = 1.0 + 0.45 * (1 - (z + h / 2) / LEG_TOP) ** 3
        for side in (-1, 1):
            if kit.rng.random() < 0.8:
                kit.box(f"leg_px{z:.0f}{side}", (0.25, ly * widen - 0.2, h - 0.3), (side * lx * widen / 2, LEG_Y, z + h / 2), "metal_light" if kit.rng.random() < 0.7 else "metal", rot=(0, kit.rng.uniform(-0.03, 0.03), 0), dent_by=0.05)
            if kit.rng.random() < 0.75:
                kit.box(f"leg_py{z:.0f}{side}", (lx * widen - 0.2, 0.25, h - 0.3), (0.0, LEG_Y + side * ly * widen / 2, z + h / 2), "metal" if kit.rng.random() < 0.5 else "metal_light", dent_by=0.05)
            else:
                strut(kit, f"leg_xa{z:.0f}{side}", (-lx / 2, LEG_Y + side * ly / 2, z), (lx / 2, LEG_Y + side * ly / 2, z + h), 0.3, "rust_dark")
                strut(kit, f"leg_xb{z:.0f}{side}", (lx / 2, LEG_Y + side * ly / 2, z), (-lx / 2, LEG_Y + side * ly / 2, z + h), 0.3, "rust_dark")
        z += h


def head(kit: Kit) -> None:
    """The band's torn end past the far leg: jagged plates sticking out and two hanging down."""
    end = len(ARC) - 1
    w = width_at(end)
    for i in range(5):
        x = -w / 2 + (i + 0.5) * w / 5
        length = kit.rng.uniform(1.0, 3.2)
        plate(kit, f"torn{i}", end + length / 6, THICK / 2 + SKIN / 2 + kit.rng.uniform(-0.3, 0.1), x, (w / 5 - 0.1, length, SKIN), "metal_light" if i % 2 else "metal", tilt=kit.rng.uniform(-0.25, 0.1), dent_by=0.1)
    for i, x in enumerate((-2.2, 2.6)):
        y, z = point_at(end)
        kit.box(f"hanging{i}", (2.4, 0.2, 5.0), (x, y + 1.0, z - 2.0), "metal_light", rot=(kit.rng.uniform(-0.2, 0.2), 0.1, 0), dent_by=0.08)
    for i in range(4):
        strut(kit, f"torn_rib{i}", off(end, -0.5 + i * 0.4, -w / 2 + 1 + i * 2.2), off(end + 0.35, -0.2 + i * 0.3, -w / 2 + 1.3 + i * 2.2), 0.3, "rust_dark")


def feet(kit: Kit) -> None:
    """Torn plate stubs, debris plates, broken struts and sand drifts at both feet. All of it lies at |Y| >= 14."""
    mound(kit, "near_drift", 5.0, 2.4, (0.5, -19.5))
    mound(kit, "near_drift2", 3.5, 1.4, (-5.0, -18.5))
    mound(kit, "far_drift", 4.5, 2.0, (0.0, 19.5))
    for i, (cx, cy) in enumerate(((0.0, -19.0), (0.0, 18.5))):
        for j in range(14):
            a = kit.rng.uniform(0, math.tau)
            d = kit.rng.uniform(2.5, 8.0)
            x = cx + math.cos(a) * d * 0.8
            y = cy + math.sin(a) * d * 0.6
            size = (kit.rng.uniform(1.2, 3.0), kit.rng.uniform(1.0, 2.4), 0.2)
            rot = (kit.rng.uniform(-0.6, 0.6), kit.rng.uniform(-0.6, 0.6), kit.rng.uniform(0, math.tau))
            kit.box(f"debris{i}_{j}", size, (x, y, 0.5), "metal_light" if j % 3 else "rust", rot=rot, dent_by=0.1)
        for j in range(7):
            a = kit.rng.uniform(0, math.tau)
            x0, y0 = cx + math.cos(a) * 4.0, cy + math.sin(a) * 2.0
            strut(kit, f"scrap{i}_{j}", (x0, y0, 0.1), (x0 + kit.rng.uniform(-3, 3), y0 + kit.rng.uniform(-1, 1), kit.rng.uniform(0.6, 2.4)), 0.3, "rust_dark")
    # Stub plates torn up around the near foot, leaning on the band.
    for j, x in enumerate((-5.0, -2.2, 2.0, 4.8)):
        kit.box(f"stub{j}", (2.2, 0.25, 3.2), (x, -15.6 - (j % 2) * 0.8, 1.2), "metal_light" if j % 2 else "metal", rot=(kit.rng.uniform(-0.5, -0.2), 0, kit.rng.uniform(-0.3, 0.3)), dent_by=0.1)


def build(kit: Kit) -> None:
    band(kit)
    ribs(kit)
    lattice(kit)
    far_leg(kit)
    head(kit)
    feet(kit)


def turn() -> None:
    """Turns every part by TURN about the origin's vertical axis, so the feet line crosses the road at a slant."""
    rot = Matrix.Rotation(TURN, 4, "Z")
    for obj in bpy.context.scene.objects:
        obj.matrix_world = rot @ obj.matrix_world


def check_reach() -> None:
    """Raises if any part lies past BAKE_RADIUS, or has a corner over the road below CLEAR. src/data/prop-shapes.test.ts
    checks the collision boxes themselves."""
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
        reach = max(math.hypot(p.x, p.y) for p in pts)
        if reach > BAKE_RADIUS:
            raise ValueError(f"{obj.name} reaches {reach:.2f} m, past BAKE_RADIUS {BAKE_RADIUS}")
        low = [p for p in pts if abs(p.y) < ROAD_HALF and p.z < CLEAR]
        if low:
            raise ValueError(f"{obj.name} has a point over the road below {CLEAR} m at {tuple(low[0])}")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    turn()
    check_reach()
    kit.export("ship_wing", args, view_size=70)


if __name__ == "__main__":
    main()
