"""Fallen Sun cage: an open ribcage section of the crashed colony ship's hull that trucks drive through.

Reference radius 50 m. The cage is 100 m long along X: a plated shell band 10 m long at each end with nine bare
rib rings between them, 8 m apart. The rings have an outer radius of 16 m round an axis 4 m above the
ground, so the cage stands 31 m wide on the sand and 20 m tall. Stringers run along the upper half and a few
skin plates still cover the top. Both ends are open and there is no floor: nothing inside the tube comes lower
than 4 m above the ground except the rib and shell walls themselves, which stand 14.2 m or more from the centre line
at the ground, so a truck drives the whole length.
Run: blender --background --python tools/blender/ship_cage.py -- public/models/ship_cage.glb [tmp/ship_cage.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "hull": 0xC4BAA6,  # PAL.hull.light
    "hull_grey": 0x8E887C,  # PAL.hull.grey
    "hull_dark": 0x6E6A62,  # PAL.hull.dark
    "rust": 0x7E5634,  # PAL.hull.rust
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "soot": 0x1E1A18,
}
SEED = 82

R = 16.0  # outer radius of the rings
CZ = 4.0  # axis height above the ground
HALF = 50.0
END = 10.0  # length of the plated shell band at each end
RIBS = 9
SEGS = 12  # segments of each ring from ground to ground
GROUND = math.acos(-(CZ + 0.4) / R)  # ring angle from the top where it sinks 0.4 m into the sand
STEP = 2 * GROUND / SEGS


def patch(
    kit: Kit,
    name: str,
    x0: float,
    x1: float,
    a0: float,
    a1: float,
    mat: str,
    r: float = R,
    thick: float = 0.8,
    segs: int = 1,
    tear: float = 0.0,
    dent_by: float = 0.0,
) -> bpy.types.Object:
    """A curved solid panel round the cage axis from x0 to x1 with its outer face at radius r.

    Angles are radians from the top, positive toward -Y. tear pulls each column's ends in by up to that many
    meters, so the ends read as torn.
    """
    bm = bmesh.new()
    cols = []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        col = []
        for x in (x0 + kit.rng.uniform(0, tear), x1 - kit.rng.uniform(0, tear)):
            for rr in (r, r - thick):
                col.append(bm.verts.new((x, -math.sin(a) * rr, CZ + math.cos(a) * rr)))
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


def seg(k: int) -> float:
    """Angle of ring vertex k, counted from the ground on the +Y side."""
    return -GROUND + k * STEP


def end_shells(kit: Kit) -> None:
    # Plated bands at both ends, built of a few wide plates each, with torn outer edges.
    for side, sign in (("aft", -1), ("fore", 1)):
        inner, outer = sign * (HALF - END), sign * HALF
        x0, x1 = min(inner, outer), max(inner, outer)
        k = 0
        while k < SEGS:
            run = min(kit.rng.randint(2, 4), SEGS - k)
            mat = kit.rng.choices(["hull", "hull_grey", "rust_side"], weights=[10, 3, 1])[0]
            tear_end = kit.rng.uniform(0.5, 2.5)
            a, b = (x0 + tear_end, x1) if sign < 0 else (x0, x1 - tear_end)
            patch(kit, f"{side}_shell_{k}", a, b, seg(k), seg(k + run), mat, thick=0.7, segs=run, dent_by=0.05)
            k += run
        # A raised seam ring on the inner edge of each shell band.
        x = inner - sign * 0.6
        patch(kit, f"{side}_seam", x - 0.6, x + 0.6, seg(0), seg(SEGS), "hull_dark", r=R + 0.35, thick=1.1, segs=SEGS, dent_by=0.05)


def ribs(kit: Kit) -> None:
    pitch = (2 * (HALF - END)) / (RIBS + 1)
    for i in range(RIBS):
        x = -(HALF - END) + pitch * (i + 1)
        mat = "hull" if i % 3 else "hull_grey"
        if i == 6:
            # A rib snapped near the top: its two halves stop short of each other.
            patch(kit, f"rib_{i}_a", x - 1.0, x + 1.0, seg(0), seg(5), mat, thick=1.1, segs=5, dent_by=0.1)
            patch(kit, f"rib_{i}_b", x - 1.0, x + 1.0, seg(7), seg(SEGS), mat, thick=1.1, segs=5, dent_by=0.1)
        else:
            patch(kit, f"rib_{i}", x - 1.0, x + 1.0, seg(0), seg(SEGS), mat, thick=1.1, segs=SEGS, dent_by=0.1)
        if i % 2 == 0:
            k = kit.rng.randrange(0, SEGS - 2)
            patch(kit, f"rib_rust_{i}", x - 1.05, x + 1.05, seg(k), seg(k + 2), "rust", r=R + 0.06, thick=0.06, segs=2)


def stringers(kit: Kit) -> None:
    # Longitudinal stringers along the upper half only, all well above the 4 m clearance.
    for j, k in enumerate((3, 5, 6, 7, 9)):
        a = seg(k)
        start = -(HALF - END) - 0.5 + (kit.rng.uniform(0, 9) if j in (1, 4) else 0)
        patch(kit, f"stringer_{j}", start, HALF - END + 0.5, a - 0.035, a + 0.035, "hull_grey", r=R - 0.3, thick=0.7, dent_by=0.08)


def top_plates(kit: Kit) -> None:
    # A few skin plates left on the top, one sagging loose.
    pitch = (2 * (HALF - END)) / (RIBS + 1)
    for j, (bay, k, span) in enumerate(((0, 6, 2), (1, 5, 3), (4, 6, 1), (8, 4, 2), (9, 6, 2))):
        x0 = -(HALF - END) + pitch * bay
        mat = kit.rng.choice(["hull", "hull_grey", "rust_side"])
        patch(kit, f"top_plate_{j}", x0 + 0.3, x0 + pitch - 0.3, seg(k), seg(k + span), mat, r=R + 0.05, thick=0.3, segs=span, tear=1.5, dent_by=0.15)
    sag = patch(kit, "sag_plate", -2.0, 5.0, seg(7), seg(8), "rust_side", r=R, thick=0.3, dent_by=0.2)
    sag.rotation_euler = (math.radians(-9), 0, 0)


def rust(kit: Kit) -> None:
    # Rust patches and streaks on the end shells, on the ring grid so they lie on the plates.
    for i in range(14):
        sign = kit.rng.choice((-1, 1))
        k = kit.rng.randrange(0, SEGS)
        w = kit.rng.uniform(1.5, 4.5)
        x = sign * kit.rng.uniform(HALF - END + 1.2, HALF - 3.0)
        mat = kit.rng.choice(["rust", "rust", "rust_side", "rust_dark"])
        patch(kit, f"rust_{i}", x - w / 2, x + w / 2, seg(k), seg(k + 1), mat, r=R + 0.06, thick=0.05)


def debris(kit: Kit) -> None:
    # Fallen plates outside the walls, clear of the drive line.
    kit.box("fallen_0", (6.0, 4.0, 0.4), (-20, -19.5, 0.5), "hull_grey", rot=(math.radians(10), math.radians(-6), math.radians(20)), dent_by=0.25)
    kit.box("fallen_1", (5.0, 3.5, 0.4), (28, 19.0, 0.6), "rust_side", rot=(math.radians(-14), 0, math.radians(-35)), dent_by=0.25)


def build(kit: Kit) -> None:
    end_shells(kit)
    ribs(kit)
    stringers(kit)
    top_plates(kit)
    rust(kit)
    debris(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_cage", args, view_size=120.0)


if __name__ == "__main__":
    main()
