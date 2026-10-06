"""Fallen Sun hull shell: a half-buried arch of the crashed colony ship's hull that trucks drive through.

Reference radius 24 m. The shell is 48 m long along X: half a sixteen-sided tube of radius 18 m with its axis on
the ground, so it stands 36 m wide and 18 m tall. The skin is 0.6 m thick in three sections joined by raised
ring bands, with a heavier rim at the +X end and the -X section a step narrower, torn edges at both open ends, one plate missing over bare ribs, and
rust patches. The inside is lined dark. There is no floor: nothing inside comes lower than 4 m above the ground
except the walls, which stand at 16.2 m or more from the centre line below 4 m, so a truck drives straight through.
Run: blender --background --python tools/blender/hull_shell.py -- public/models/hull_shell.glb [tmp/hull_shell.png]
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
SEED = 84

R = 18.0
THICK = 0.6
HALF = 24.0
SEGS = 16  # segments from ground to ground
GROUND = math.radians(93)  # sinks the wall foot about 1 m into the sand
STEP = 2 * GROUND / SEGS
SECTIONS = (-24.0, -8.0, 8.0, 24.0)
SECTION_R = (R - 0.7, R, R)  # the -X section is a step narrower, like a telescoped ring
MISSING = (1, 4, 6)  # section and segment span with the plate torn away over bare ribs


def patch(
    kit: Kit,
    name: str,
    x0: float,
    x1: float,
    a0: float,
    a1: float,
    mat: str,
    r: float = R,
    thick: float = THICK,
    segs: int = 1,
    tear0: float = 0.0,
    tear1: float = 0.0,
    dent_by: float = 0.0,
) -> bpy.types.Object:
    """A curved solid panel round the X axis at ground level, from x0 to x1 with its outer face at radius r.

    Angles are radians from the top, positive toward -Y. tear0 and tear1 pull each column's x0 and x1 ends in by
    up to that many meters, so those ends read as torn.
    """
    bm = bmesh.new()
    cols = []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        col = []
        for x in (x0 + kit.rng.uniform(0, tear0), x1 - kit.rng.uniform(0, tear1)):
            for rr in (r, r - thick):
                col.append(bm.verts.new((x, -math.sin(a) * rr, math.cos(a) * rr)))
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
    """Angle of shell vertex k, counted from the ground on the +Y side."""
    return -GROUND + k * STEP


def skin(kit: Kit) -> None:
    # Each section is a few wide plates. The outer ends of the end sections are torn.
    for s in range(len(SECTIONS) - 1):
        x0, x1 = SECTIONS[s], SECTIONS[s + 1]
        k = 0
        while k < SEGS:
            if s == MISSING[0] and MISSING[1] <= k < MISSING[2]:
                k += 1
                continue
            run = min(kit.rng.randint(2, 4), SEGS - k)
            if s == MISSING[0] and k < MISSING[1]:
                run = min(run, MISSING[1] - k)
            mat = kit.rng.choices(["hull", "hull_grey", "hull_dark", "rust_side"], weights=[12, 4, 1, 0.5])[0]
            patch(kit, f"skin_{s}_{k}", x0, x1, seg(k), seg(k + run), mat, r=SECTION_R[s], segs=run, tear0=2.5 if s == 0 else 0.0, tear1=1.2 if s == 2 else 0.0, dent_by=0.05)
            k += run
    # A dark lining inside, so the open ends show a shadowed interior.
    patch(kit, "lining", SECTIONS[1], SECTIONS[-1] - 1.3, seg(0), seg(SEGS), "rust_dark", r=R - THICK - 0.02, thick=0.15, segs=SEGS)
    # Bare ribs where the plate is gone, over the dark lining.
    for i, x in enumerate((-4.0, 0.0, 4.0)):
        patch(kit, f"bare_rib_{i}", x - 0.4, x + 0.4, seg(MISSING[1]) - 0.05, seg(MISSING[2]) + 0.05, "hull_grey", r=R - 0.1, thick=0.8, segs=2)


def bands(kit: Kit) -> None:
    for i, x in enumerate(SECTIONS[1:-1]):
        patch(kit, f"band_{i}", x - 1.1, x + 1.1, seg(0), seg(SEGS), "hull_grey", r=R + 0.5, thick=1.2, segs=SEGS, dent_by=0.08)
    patch(kit, "rim", HALF - 2.6, HALF - 0.6, seg(0), seg(SEGS), "hull_dark", r=R + 0.6, thick=1.6, segs=SEGS, tear1=0.5, dent_by=0.1)


def rust(kit: Kit) -> None:
    # Rust patches and streaks on the shell grid, so they lie flat on the plates.
    for i in range(16):
        k = kit.rng.randrange(1, SEGS - 1)
        w = kit.rng.uniform(2.0, 6.0)
        x = kit.rng.uniform(-8 + 1.2 + w / 2, HALF - 3 - w / 2)
        if -8 < x < 8 and MISSING[1] <= k < MISSING[2]:
            continue
        mat = kit.rng.choice(["rust", "rust", "rust_side", "rust_dark"])
        patch(kit, f"rust_{i}", x - w / 2, x + w / 2, seg(k), seg(k + 1), mat, r=R + 0.05, thick=0.05)
    # Long streaks running down from the top bands.
    for i, x in enumerate((-12.0, 3.0, 15.0)):
        k = kit.rng.choice((4, 5, 10, 11))
        patch(kit, f"streak_{i}", x - 0.6, x + 0.6, seg(k), seg(k + 2), "rust_side", r=R + 0.06, thick=0.05, segs=2)


def debris(kit: Kit) -> None:
    # Torn plates fallen outside the walls, clear of the drive line.
    kit.box("fallen_0", (5.0, 4.0, 0.4), (-20, -23, 0.6), "hull_grey", rot=(math.radians(12), math.radians(-8), math.radians(30)), dent_by=0.25)
    kit.box("fallen_1", (4.0, 3.0, 0.4), (26, 21, 0.5), "rust_side", rot=(math.radians(-10), 0, math.radians(-20)), dent_by=0.25)


def build(kit: Kit) -> None:
    skin(kit)
    bands(kit)
    rust(kit)
    debris(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("hull_shell", args, view_size=70.0)


if __name__ == "__main__":
    main()
