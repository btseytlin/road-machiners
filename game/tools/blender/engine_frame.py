"""Glass Flats engine frame: the collapsed girder cradle that once held the colony ship's engine.

Reference radius 15 m, half its length along +x, built at its real size and drawn at scale 1. Four round-shouldered arches of
heavy rust girders span the length along X, their feet 30 m apart at x = -15 and 15 m and their crowns 15 m up. The
arches stand in a row across Y from -7.5 m to 7.5 m, tied by cross girders at the crown and on both slopes. The near
(-y) arch has sagged at its -x leg, so its crown leans toward -x and drops to 12 m, and the +y arch has a snapped -x
leg. A long plated girder leans from the crown to the sand past the +x feet. Each leg is one girder below truck
clearance (2.8 m) and a laced two-chord truss above it, so only the feet block a truck and trucks drive under the
arches. Red cloth hangs from the slope girders with its lowest edge at 3.2 m. The frame is 34 m long over the leaning
girder, 20 m wide over the plated girder's foot and 15.6 m tall.
Sizes are measured from docs/concepts/glass-flats-game-style-issue-112.jpg (tmp/models/engine_frame/asset-brief.md).
Run: blender --background --python tools/blender/engine_frame.py -- public/models/engine_frame.glb [tmp/engine_frame.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "plate": 0x8E887C,  # PAL.hull.grey
    "streak": 0x7E5634,  # PAL.hull.rust
    "cloth": 0x8A3A2A,  # PAL.roof[2], red tarp
}
SEED = 113

FOOT_X = 15.0  # m, half the span of each arch's feet
CROWN_X = 3.0  # m, half the flat top of each arch
KNEE = (10.0, 0.68)  # each leg bends at this distance off the arch middle and share of the crown height, so the arch rounds its shoulders
KNEE_T = 0.6  # share of a leg's slope() run that lies below the knee
H = 15.0  # m, crown height of a standing arch
ARCH_Y = (-7.5, -2.5, 2.5, 7.5)  # m, the four arches across Y
CLEAR = 3.2  # m, where each leg's truss starts, above PHYSICS.truckClearance (2.8 m)
CHORD = 0.75  # m, main girder section
LACE = 0.3  # m, lacing strut section
INNER = 1.4  # m, depth of a leg's truss under its main girder


def lerp(a: Vec3, b: Vec3, t: float) -> Vec3:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def leg(kit: Kit, name: str, foot: Vec3, top: Vec3, mat: str, pad: bool = True) -> None:
    """A main girder from foot to top, with an inner chord and zigzag lacing under it above CLEAR."""
    strut(kit, f"{name}_chord", foot, top, CHORD, mat, dent_by=0.04)
    if pad:
        kit.box(f"{name}_pad", (1.6, 1.6, 0.5), (foot[0], foot[1], 0.15), "rust_dark", dent_by=0.05)
    a, b = Vector(foot), Vector(top)
    u = (b - a).normalized()
    flat = Vector((u.x, u.y, 0))
    # The underside: perpendicular to the girder in its vertical plane, pointing inward and down.
    c = flat.length
    under = Vector((flat.x / c * u.z, flat.y / c * u.z, -c))
    t0 = (CLEAR - foot[2]) / (top[2] - foot[2])
    start = a.lerp(b, t0 + 0.08) + under * INNER
    end = b + under * INNER * 0.5
    start.z = max(start.z, CLEAR)
    strut(kit, f"{name}_inner", tuple(start), tuple(end), CHORD * 0.6, mat)
    bays = 5
    for i in range(bays):
        p = a.lerp(b, t0 + (1 - t0) * i / bays)
        q = start.lerp(end, (i + 0.5) / bays)
        r = a.lerp(b, t0 + (1 - t0) * (i + 1) / bays)
        strut(kit, f"{name}_lace{i}a", tuple(p), tuple(q), LACE, "rust_dark")
        strut(kit, f"{name}_lace{i}b", tuple(q), tuple(r), LACE, "rust_dark")


def slope(arch: tuple[float, float, float], side: int, t: float) -> Vec3:
    """A point t of the way up the side (-1 for -x, 1 for +x) leg of arch (y, crown shift along x, crown height)."""
    y, shift, h = arch
    foot = (side * FOOT_X, y, 0.0)
    knee = (shift * KNEE[1] + side * KNEE[0], y, h * KNEE[1])
    top = (shift + side * CROWN_X, y, h)
    if t <= KNEE_T:
        return lerp(foot, knee, t / KNEE_T)
    return lerp(knee, top, (t - KNEE_T) / (1 - KNEE_T))


def arch(kit: Kit, name: str, a: tuple[float, float, float], snapped: bool) -> None:
    y, shift, h = a
    top_l, top_r = slope(a, -1, 1), slope(a, 1, 1)
    mat = "rust" if y < 0 else "rust_side"
    if snapped:
        # The -x leg broke at 6 m: the stump stands, and the upper part hangs from the crown to the sand.
        leg(kit, f"{name}_stump", (-FOOT_X, y, 0.0), slope(a, -1, 0.3), mat)
        strut(kit, f"{name}_hang", top_l, (-9.5, y + 1.5, 0.3), CHORD, mat, dent_by=0.05)
    else:
        leg(kit, f"{name}_legl", (-FOOT_X, y, 0.0), slope(a, -1, KNEE_T), mat)
        strut(kit, f"{name}_rafterl", slope(a, -1, KNEE_T), top_l, CHORD, mat, dent_by=0.04)
    leg(kit, f"{name}_legr", (FOOT_X, y, 0.0), slope(a, 1, KNEE_T), mat)
    strut(kit, f"{name}_rafterr", slope(a, 1, KNEE_T), top_r, CHORD, mat, dent_by=0.04)
    strut(kit, f"{name}_crown", top_l, top_r, CHORD, mat, dent_by=0.04)
    kit.box(f"{name}_cap", (2.0, 1.2, 0.6), (shift, y, h + 0.35), "rust_dark", dent_by=0.05)


def build(kit: Kit) -> None:
    # Each arch is (y, crown shift along x, crown height). The near arch has sagged toward -x.
    arches = [(ARCH_Y[0], -4.0, 12.0), (ARCH_Y[1], -1.0, 14.4), (ARCH_Y[2], 0.0, H), (ARCH_Y[3], 0.5, H)]
    for i, a in enumerate(arches):
        arch(kit, f"arch{i}", a, snapped=i == 3)
    # Cross girders between neighbouring arches: at the crown, and on both slopes above the trusses.
    for i in range(len(arches) - 1):
        p, q = arches[i], arches[i + 1]
        strut(kit, f"tie_crown{i}", (p[1], p[0], p[2]), (q[1], q[0], q[2]), CHORD, "rust", dent_by=0.04)
        for side in (-1, 1):
            if i == 2 and side < 0:
                continue  # the snapped leg carries no slope ties
            for t in (0.45, 0.75):
                strut(kit, f"tie{i}{side:+d}{t}", slope(p, side, t), slope(q, side, t), 0.5, "rust_side", dent_by=0.04)
            strut(kit, f"brace{i}{side:+d}a", slope(p, side, 0.45), slope(q, side, 0.75), LACE, "rust_dark")
            strut(kit, f"brace{i}{side:+d}b", slope(p, side, 0.75), slope(q, side, 0.45), LACE, "rust_dark")
    # A long plated girder resting on the -x slope down to the near corner, and one leaning from the crown past +x.
    strut(kit, "plated_a", (-12.5, -10.0, 0.4), (-2.0, -4.0, 13.2), 1.2, "plate", dent_by=0.08)
    strut(kit, "plated_a_rust", (-12.0, -9.7, 0.9), (-7.0, -6.8, 7.0), 1.25, "streak")
    strut(kit, "plated_b", (1.0, 3.0, H + 0.2), (17.0, -1.0, 0.4), 1.0, "plate", dent_by=0.08)
    kit.box("plated_b_foot", (1.8, 1.8, 0.5), (17.0, -1.0, 0.15), "rust_dark")
    # Girders fallen across the inside, caught on the slopes, all above truck clearance.
    strut(kit, "fallen_a", (-6.0, -6.0, 9.0), (6.0, 3.0, 10.5), 0.7, "rust", dent_by=0.05)
    strut(kit, "fallen_b", (4.0, -6.5, 12.0), (-8.0, 4.0, 7.5), 0.6, "rust_side", dent_by=0.05)
    # Red cloth hanging between the two near arches at both ends: a two-panel sheet from the low slope ties out over the
    # feet, its lowest edge at 3.2 m.
    mid_y = (ARCH_Y[0] + ARCH_Y[1]) / 2
    for i, side in enumerate((-1, 1)):
        hi = slope((mid_y, 0.0, H), side, 0.45)
        low = (side * (FOOT_X + 0.5), mid_y, 3.2)
        sag = (side * (abs(hi[0]) + FOOT_X + 0.5) / 2, mid_y, (hi[2] + low[2]) / 2 - 1.0)
        for j, (a, b) in enumerate(((hi, sag), (sag, low))):
            run = Vector(b) - Vector(a)
            rot = run.to_track_quat("Z", "X").to_euler()
            kit.box(f"cloth{i}_{j}", (0.06, 4.6, run.length), lerp(a, b, 0.5), "cloth", rot=tuple(rot), dent_by=0.08)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("engine_frame", args, view_size=42.0)


if __name__ == "__main__":
    main()
