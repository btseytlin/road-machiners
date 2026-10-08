"""Fallen Sun landmark: a torn section of the crashed colony ship, half buried in sand.

Sized for the 'fallen-sun' location radius of 5 tiles, 20 m. The hull is about 26 m long,
10 m wide at the ground and 6.8 m tall, and everything fits inside the 20 m radius.
The torn open end faces +X.
Run: blender --background --python tools/blender/ship_hull.py -- public/models/ship_hull.glb [tmp/ship_hull.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import mound  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "sand": 0xC9A878,  # PAL.sand[0]
    "soot": 0x1E1A18,
}
SEED = 11

LENGTH = 26.0
RADIUS_Y = 5.2  # half width
RADIUS_Z = 5.2  # vertical half height
CENTER_Z = 0.6  # axis height at x = 0; the lower part is buried
SLOPE = 0.07  # the buried end dips and the torn end rises by this much per meter
FLOOR = -0.4  # hull vertices below this height are flattened, since the ground hides them
SIDES = 10
ALONG_X = (0, math.radians(90), 0)  # turns a cylinder's local Z onto world +X; local X becomes world -Z


def surface(x: float, phi: float, lift: float = 0.0) -> tuple[float, float, float]:
    """A point on the hull at station x and angle phi from the top, pushed out by lift."""
    return (x, (RADIUS_Y + lift) * math.sin(phi), CENTER_Z + SLOPE * x + (RADIUS_Z + lift) * math.cos(phi))


def on_hull(phi: float) -> tuple[float, float, float]:
    """Rotation that lays a box flat on the hull at angle phi, following the slope."""
    return (-phi, -math.atan(SLOPE), 0)


def tube(kit: Kit, name: str, scale: float, mat: str, tears: list[float], inward: bool) -> None:
    """A hull shell along X with the +X cap removed and a jagged torn rim.

    tears holds one +X offset per rim vertex. inward flips the faces, so the shell shows its inside.
    """
    shell = kit.cylinder(name, 1.0, LENGTH, (0, 0, CENTER_Z), mat, rot=ALONG_X, vertices=SIDES)
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    rim = sorted((v for v in bm.verts if v.co.z > 0), key=lambda v: math.atan2(v.co.y, v.co.x))
    cap = [f for f in bm.faces if all(v.co.z > 0 for v in f.verts)]
    bmesh.ops.delete(bm, geom=cap, context="FACES_ONLY")
    for v in bm.verts:
        v.co.x *= RADIUS_Z * scale
        v.co.y *= RADIUS_Y * scale
    for v, tear in zip(rim, tears):
        v.co.z += tear
    for v in bm.verts:
        # Local X is world -Z and local Z is world +X here.
        v.co.x -= SLOPE * v.co.z
        v.co.x = min(v.co.x, CENTER_Z - FLOOR)
    if inward:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(shell.data)
    bm.free()


def plating(kit: Kit) -> None:
    """Raised hull panels in bands along the upper hull, alternating light and dark metal."""
    for band, phi in enumerate((-1.25, -0.72, -0.2, 0.32, 0.84, 1.3)):
        x = -LENGTH / 2 + 1.0
        while x < LENGTH / 2 - 3.0:
            length = kit.rng.uniform(2.6, 4.2)
            if kit.rng.random() < 0.8:
                mat = "metal_light" if (band + int(x)) % 3 == 0 else "metal"
                if kit.rng.random() < 0.15:
                    mat = "rust"
                kit.box(
                    f"panel_{band}_{x:.0f}",
                    (length - 0.25, 2.3, 0.12),
                    surface(x + length / 2, phi, 0.04),
                    mat,
                    rot=on_hull(phi),
                    dent_by=0.05,
                )
            x += length


def ribs(kit: Kit, rim_x: float) -> None:
    """Broken frame ribs sticking out of the torn end, some bent outward."""
    for i in range(9):
        phi = -1.7 + i * 0.42 + kit.rng.uniform(-0.1, 0.1)
        length = kit.rng.uniform(2.6, 4.6)
        bend = kit.rng.uniform(-0.35, 0.1)
        x, y, z = surface(rim_x + length / 2 - 1.0, phi, -0.2)
        if z < 0.3:
            continue
        kit.box(f"rib{i}", (length, 0.6, 0.7), (x, y, z), "rust", rot=(-phi, bend - math.atan(SLOPE), 0), dent_by=0.05)
    # One hoop frame still standing just inside the tear.
    for i in range(SIDES):
        phi = (i + 0.5) / SIDES * math.tau
        loc = surface(rim_x - 1.6, phi, -0.5)
        if loc[2] < 0:
            continue
        seg = 2 * math.pi * RADIUS_Y / SIDES
        kit.box(f"hoop{i}", (0.6, seg, 0.5), loc, "metal_light", rot=on_hull(phi), dent_by=0.03)


def gash(kit: Kit) -> None:
    """A blast hole in the camera-side flank with a hull plate peeled outward."""
    phi = -1.0
    kit.box("gash", (4.2, 2.6, 0.2), surface(-1.0, phi, 0.02), "soot", rot=on_hull(phi), dent_by=0.2)
    x, y, z = surface(-1.0, phi - 0.45, 0.9)
    kit.box("peeled_plate", (3.6, 1.6, 0.14), (x, y, z), "metal_light", rot=(-phi - 0.9, 0.1, 0.15), dent_by=0.1)
    for i in range(3):
        kit.box(f"gash_rib{i}", (0.3, 3.0, 0.3), surface(-2.4 + i * 1.4, phi, 0.1), "rust_dark", rot=on_hull(phi), dent_by=0.08)


def fin(kit: Kit) -> None:
    """A tall swept fin near the buried end, and the stub of a second one snapped off."""
    kit.box("fin", (5.0, 0.5, 3.4), (-8.5, 0.6, CENTER_Z - 8.5 * SLOPE + RADIUS_Z + 1.2), "metal_light", rot=(math.radians(-6), math.radians(24), 0), dent_by=0.08)
    kit.box("fin_edge", (4.6, 0.6, 0.35), (-7.7, 0.62, CENTER_Z - 7.7 * SLOPE + RADIUS_Z + 2.6), "rust", rot=(math.radians(-6), math.radians(24), 0), dent_by=0.05)
    kit.box("fin_stub", (2.2, 0.45, 1.3), (-5.0, -4.0, CENTER_Z - 5.0 * SLOPE + 3.6), "metal", rot=(math.radians(-48), math.radians(10), 0), dent_by=0.08)


def sand(kit: Kit) -> None:
    """Sand drifts piled against both flanks and over the buried end."""
    for i, (x, y, r, h) in enumerate(((-9, 4.8, 3.4, 1.8), (-2, 5.2, 2.6, 1.0), (6, 5.0, 2.2, 0.7), (-9, -5.0, 3.4, 1.9), (-3, -5.2, 2.6, 1.2), (3, -5.3, 2.2, 0.8), (-14, 0, 5.6, 3.6))):
        mound(kit, f"drift{i}", r, h, (x, y))


def debris(kit: Kit) -> None:
    """Plates and chunks scattered around, mostly out past the torn end."""
    for i in range(14):
        a = kit.rng.uniform(-1.9, 1.9) if i < 10 else kit.rng.uniform(0, math.tau)
        d = kit.rng.uniform(15.0, 18.0) if i < 10 else kit.rng.uniform(8.0, 12.0)
        x, y = math.cos(a) * d, math.sin(a) * d * 0.75
        if i % 3 == 0:
            size = (kit.rng.uniform(1.0, 1.8), kit.rng.uniform(0.8, 1.4), kit.rng.uniform(0.6, 1.1))
            mat = "metal"
        else:
            size = (kit.rng.uniform(1.4, 2.8), kit.rng.uniform(0.9, 1.8), 0.14)
            mat = "rust" if i % 3 == 1 else "metal_light"
        tilt = (kit.rng.uniform(-0.3, 0.3), kit.rng.uniform(-0.3, 0.3), kit.rng.uniform(0, math.tau))
        kit.box(f"debris{i}", size, (x, y, size[2] * 0.3), mat, rot=tilt, dent_by=0.08)


def build(kit: Kit) -> None:
    tears = [kit.rng.uniform(-2.2, 0.6) for _ in range(SIDES)]
    tube(kit, "hull", 1.0, "metal", tears, inward=False)
    tube(kit, "hull_inside", 0.94, "soot", tears, inward=True)
    plating(kit)
    ribs(kit, LENGTH / 2)
    gash(kit)
    fin(kit)
    sand(kit)
    debris(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_hull", args, view_size=40)


if __name__ == "__main__":
    main()
