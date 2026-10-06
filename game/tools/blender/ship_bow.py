"""Fallen Sun bow: the forward hull of the crashed colony ship, the largest wreck in the crater.

Reference radius 66 m. The bow is 132 m long along X. Its hull is a 20-sided tube of radius 17 m with the
axis 5 m above the ground, so it sits 32 m wide on the sand and 22 m tall; everything below the ground is cut
away and there is no floor inside. The aft end at x = -66 is a torn open break. The aft 56 m are bare rib bands
round a dark inner tube, and the forward hull is plated, tapering to a closed blunt nose at x = +66 that dips
into the sand. A round breach 12 m across opens the -Y flank at x = +10, at mid height, onto a dark interior,
where the separate reactor model stands.
Run: blender --background --python tools/blender/ship_bow.py -- public/models/ship_bow.glb [tmp/ship_bow.png]
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
SEED = 81

R = 17.0  # hull radius
CZ = 5.0  # axis height above the ground
FACETS = 20  # hull sides round the full circle
STEP = math.tau / FACETS
LOW = 6  # facets from the top down to the ground on each side, so the hull runs from -108 to +108 degrees
AFT = -66.0
RIBS_END = -10.0  # the rib section runs from AFT to here
RIBS = 9
BREACH = (10.0, math.radians(90), 7.0)  # x, angle and radius of the round hole in the near flank
# Forward hull stations (x, radius). Close stations round the breach give it a round, ragged edge.
STATIONS = [
    (-10, R), (-6, R), (-2, R), (2, R), (6, R), (10, R), (14, R), (18, R), (22, R), (27, R),
    (32, 16.6), (38, 15.8), (44, 14.4), (50, 12.4), (55, 10.2), (59, 8.0), (62, 6.2), (64.5, 4.6), (66, 3.6),
]


def axis_z(r: float) -> float:
    """Keeps the narrowing nose resting in the sand: the axis drops once the radius is too small to reach the ground."""
    return min(CZ, r - 1.5)


def patch(
    kit: Kit,
    name: str,
    x0: float,
    x1: float,
    a0: float,
    a1: float,
    mat: str,
    r0: float = R,
    r1: float | None = None,
    thick: float = 0.5,
    segs: int = 1,
    tear: float = 0.0,
    dent_by: float = 0.0,
) -> bpy.types.Object:
    """A curved solid hull panel round the X axis from x0 to x1, radius r0 to r1 at its outer face.

    Angles are radians from the top, positive toward -Y. tear pulls each edge column's ends in by up to that
    many meters, so the ends read as torn.
    """
    r1 = r0 if r1 is None else r1
    bm = bmesh.new()
    cols = []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        col = []
        for x, r in ((x0 + kit.rng.uniform(0, tear), r0), (x1 - kit.rng.uniform(0, tear), r1)):
            cz = axis_z(r)
            for rr in (r, r - thick):
                col.append(bm.verts.new((x, -math.sin(a) * rr, cz + math.cos(a) * rr)))
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


def facet(k: int) -> tuple[float, float]:
    """Angles of hull facet k, counted from the top toward -Y."""
    return k * STEP, (k + 1) * STEP


def skin_mat(kit: Kit) -> str:
    return kit.rng.choices(["hull", "hull_grey", "hull_dark", "rust_side"], weights=[12, 3, 1, 1])[0]


def ribs(kit: Kit) -> None:
    # A dark inner tube shows through the gaps between the rib bands and out of the torn aft end.
    patch(kit, "inner_tube", AFT + 0.5, RIBS_END + 1, -math.radians(117), math.radians(117), "soot", r0=14.0, thick=0.3, segs=13, tear=1.5)
    pitch = (RIBS_END - AFT) / RIBS
    for i in range(RIBS):
        x = AFT + pitch * (i + 0.5)
        mat = "hull" if i % 3 else "hull_grey"
        patch(kit, f"rib_{i}", x - 1.3, x + 1.3, -LOW * STEP, LOW * STEP, mat, r0=R + 0.2, thick=1.6, segs=2 * LOW, dent_by=0.12)
        # A rust collar on some ribs.
        if i % 2:
            k = kit.rng.randrange(-LOW, LOW - 2)
            patch(kit, f"rib_rust_{i}", x - 1.35, x + 1.35, k * STEP, (k + 2) * STEP, "rust", r0=R + 0.28, thick=0.06, segs=2)
    # Longitudinal stringers tie the ribs along the top and the shoulders.
    for j, k in enumerate((-2, 0, 2)):
        a0, a1 = k * STEP - 0.06, k * STEP + 0.06
        patch(kit, f"stringer_{j}", AFT + 2 + kit.rng.uniform(0, 4), RIBS_END, a0, a1, "hull_grey", r0=R + 0.5, thick=0.9, segs=1, dent_by=0.1)
    # A few skin plates still hang between ribs.
    for j, (i, k, span) in enumerate(((2, 1, 2), (5, -3, 1), (7, 3, 2), (1, -1, 1))):
        x = AFT + pitch * (i + 1)
        a0, a1 = facet(k)
        patch(kit, f"torn_plate_{j}", x - pitch / 2 - 1, x + pitch / 2 + 1, a0, a1 + (span - 1) * STEP, skin_mat(kit), r0=R, thick=0.35, segs=span, tear=2.0, dent_by=0.25)
    # Torn plates at the open aft end, one bent out and one fallen in the sand.
    kit.box("aft_flap", (6.0, 5.0, 0.35), (AFT - 1.5, -11, 14.0), "hull_grey", rot=(math.radians(35), math.radians(-30), 0), dent_by=0.3)
    kit.box("aft_fallen", (7.0, 6.0, 0.4), (AFT + 8, 21, 0.6), "rust_side", rot=(math.radians(8), math.radians(-6), math.radians(25)), dent_by=0.3)


def in_breach(x: float, a: float, r: float) -> bool:
    bx, ba, br = BREACH
    return math.hypot(x - bx, (a - ba) * r) < br


def forward(kit: Kit) -> None:
    for s in range(len(STATIONS) - 1):
        (x0, r0), (x1, r1) = STATIONS[s], STATIONS[s + 1]
        # Plates two to four facets wide, broken where the breach cuts through.
        k = -LOW
        while k < LOW:
            if in_breach((x0 + x1) / 2, sum(facet(k)) / 2, r0):
                k += 1
                continue
            run = 1
            while run < kit.rng.randint(2, 4) and k + run < LOW and not in_breach((x0 + x1) / 2, sum(facet(k + run)) / 2, r0):
                run += 1
            patch(kit, f"skin_{s}_{k}", x0, x1, k * STEP, (k + run) * STEP, skin_mat(kit), r0=r0, r1=r1, thick=0.5, segs=run, dent_by=0.03)
            k += run
        # The far half has a dark lining, seen through the breach. It stops short of the near flank.
        if x0 < 26:
            patch(kit, f"lining_{s}", x0, x1, -LOW * STEP, STEP, "soot", r0=r0 - 0.6, r1=r1 - 0.6, thick=0.2, segs=LOW + 1)
    # Seam bands round the plated hull, and a raised keel plate along the top.
    for j, x in enumerate((-10.0, 22.0, 44.0)):
        r = dict(STATIONS)[int(x)]
        patch(kit, f"band_{j}", x - 0.8, x + 0.8, -LOW * STEP, LOW * STEP, "hull_dark", r0=r + 0.35, thick=0.6, segs=2 * LOW, dent_by=0.05)
    patch(kit, "keel", -6.0, 40.0, -0.12, 0.12, "hull_grey", r0=R + 0.6, r1=15.8, thick=1.0, dent_by=0.08)
    kit.cylinder("nose_cap", 3.7, 0.8, (66.2, 0, axis_z(3.6)), "hull_dark", rot=(0, math.radians(90), 0), vertices=10, dent_by=0.08)


def throat(kit: Kit) -> None:
    """A dark open collar lining the breach, so its edge reads as a hole into the hull, not a missing plate."""
    bx, ba, br = BREACH
    bm = bmesh.new()
    n = 12
    rings = []
    for y in (-R - 0.4, -R + 2.6):
        rings.append([[bm.verts.new((bx + math.cos(i * math.tau / n) * rr, y, CZ + math.sin(i * math.tau / n) * rr)) for i in range(n)] for rr in (br - 0.6, br - 1.2)])
    for i in range(n):
        j = (i + 1) % n
        (fo, fi), (bo, bi) = rings
        bm.faces.new((fo[i], fo[j], bo[j], bo[i]))
        bm.faces.new((fi[i], bi[i], bi[j], fi[j]))
        bm.faces.new((fo[i], fi[i], fi[j], fo[j]))
        bm.faces.new((bo[i], bo[j], bi[j], bi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new("throat")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("throat", mesh)
    bpy.context.scene.collection.objects.link(obj)
    kit._add(obj, "throat", "soot", 0.5)


def breach_rim(kit: Kit) -> None:
    # Bent petals of skin round the hole, some pushed in and some curled out, like a blast from inside.
    bx, ba, br = BREACH
    for i in range(9):
        t = i * math.tau / 9 + kit.rng.uniform(-0.2, 0.2)
        u, v = math.cos(t) * (br + 0.6), math.sin(t) * (br + 0.6)  # along x, along the surface
        a = ba + v / R
        y, z = -math.sin(a) * (R + 0.3), CZ + math.cos(a) * (R + 0.3)
        size = (kit.rng.uniform(2.5, 4.5), 0.3, kit.rng.uniform(2.0, 3.5))
        curl = kit.rng.uniform(-0.6, 0.6)
        kit.box(f"petal_{i}", size, (bx + u, y, z), kit.rng.choice(["hull", "hull_grey", "rust"]), rot=(curl + (a - ba), 0, t), dent_by=0.2)


def cracks(kit: Kit) -> None:
    # Dark cracks running out from the breach across the plating.
    bx, ba, br = BREACH
    for i, t in enumerate((0.3, 1.2, 2.3, 3.4, 4.6, 5.5)):
        length = kit.rng.uniform(5.0, 11.0)
        mid = br + length / 2 - 0.5
        u, v = math.cos(t) * mid, math.sin(t) * mid
        a = ba + v / R
        y, z = -math.sin(a) * (R + 0.12), CZ + math.cos(a) * (R + 0.12)
        crack = kit.box(f"crack_{i}", (length, 0.1, 0.45), (bx + u, y, z), "soot", dent_by=0.05)
        # Turn the crack along its direction t in the flank's plane, then onto the hull's curve at angle a.
        crack.rotation_mode = "YXZ"
        crack.rotation_euler = (a - ba, t, 0)


def rust(kit: Kit) -> None:
    # Rust patches and streaks on the plated hull, laid on the facet grid so they never sink into it.
    for i in range(26):
        s = kit.rng.randrange(0, 13)
        (x0, r0), (x1, r1) = STATIONS[s], STATIONS[s + 1]
        k = kit.rng.randrange(-LOW, LOW)
        a0, a1 = facet(k)
        if in_breach((x0 + x1) / 2, (a0 + a1) / 2, r0):
            continue
        w = (x1 - x0) * kit.rng.uniform(0.3, 0.9)
        xm = kit.rng.uniform(x0, x1 - w)
        f0, f1 = (xm - x0) / (x1 - x0), (xm + w - x0) / (x1 - x0)
        mat = kit.rng.choice(["rust", "rust", "rust_side", "rust_dark"])
        patch(kit, f"rust_{i}", xm, xm + w, a0, a1, mat, r0=r0 + (r1 - r0) * f0 + 0.08, r1=r0 + (r1 - r0) * f1 + 0.08, thick=0.05)


def build(kit: Kit) -> None:
    ribs(kit)
    forward(kit)
    throat(kit)
    breach_rim(kit)
    cracks(kit)
    rust(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_bow", args, view_size=150.0)


if __name__ == "__main__":
    main()
