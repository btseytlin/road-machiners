"""Glass Flats engine nozzle: the colony ship's engine bell, a hollow ribbed cylinder lying half buried in the sand.

Reference radius 13 m, half its length along +x, built at its real size and drawn at scale 1. The nozzle is 26 m long
along X with its open mouth at +x. The front half is plated and its rings have an outer radius of 6.5 m, flaring to
7.3 m at the mouth ring. The back half is bare rib rings of 6.0 m with stringers along the top and a few plates left on
the far side. The ring axis lies 1.4 m above the sand, so the nozzle stands 7.9 m tall and 13 m wide on the ground.
Both ends are open and the sand inside is the floor: nothing inside the tube comes lower than truck clearance (2.8 m)
within 4.4 m of the axis, so a truck drives into the mouth and on through. A sand drift heaps against the near (-y)
side where the two halves meet, and a ladder leans inside the mouth against the near wall.
Sizes are measured from docs/concepts/glass-flats-game-style-issue-112.jpg (tmp/models/engine_nozzle/asset-brief.md).
Run: blender --background --python tools/blender/engine_nozzle.py -- public/models/engine_nozzle.glb [tmp/engine_nozzle.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import arc_panel, mound, strut  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "plate": 0x8E887C,  # PAL.hull.grey
    "plate_dark": 0x6E6A62,  # PAL.hull.dark
    "streak": 0x7E5634,  # PAL.hull.rust
    "sand": 0xC9A878,  # PAL.sand[0]
    "soot": 0x1E1A18,
}
SEED = 112

CZ = 1.4  # m, ring axis above the sand
R_BACK = 6.0  # m, outer radius of the bare back rings
R_FRONT = 6.5  # m, outer radius of the plated front rings
R_MOUTH = 7.3  # m, outer radius of the mouth ring
X_BACK = -13.0  # m, the open back end
X_JOINT = -1.0  # m, where the back half meets the front half
X_MOUTH = 13.0  # m, the open mouth
SEGS = 12  # segments of a ring from ground to ground
RIB = 0.6  # m, radial depth of a rib


def ground_angle(r: float) -> float:
    """Angle from the top where a ring of outer radius r sinks 0.3 m into the sand."""
    return math.acos(-(CZ + 0.3) / r)


def seg(r: float, k: float) -> float:
    """Angle of ring step k of SEGS on a ring of outer radius r, counted from the ground on the +Y side."""
    g = ground_angle(r)
    return -g + k * 2 * g / SEGS


def ring(kit: Kit, name: str, x: float, r: float, depth: float, mat: str, gap: tuple[int, int] | None = None) -> None:
    """A rib ring at x, depth meters along X. gap leaves ring steps [gap[0], gap[1]) out, for a snapped rib."""
    spans = [(0, SEGS)] if gap is None else [(0, gap[0]), (gap[1], SEGS)]
    for i, (k0, k1) in enumerate(spans):
        arc_panel(kit, f"{name}_{i}", x - depth / 2, x + depth / 2, seg(r, k0), seg(r, k1), r + 0.25, CZ, mat, thick=RIB, segs=k1 - k0, dent_by=0.06)


def back_half(kit: Kit) -> None:
    # Five bare rings, one snapped at the top.
    for i, x in enumerate((-12.4, -9.8, -7.2, -4.6, -2.0)):
        ring(kit, f"back_rib{i}", x, R_BACK, 0.8, "rust" if i % 2 else "rust_side", gap=(5, 7) if i == 2 else None)
    # Stringers along the upper half, each a thin strip on the ring faces.
    for j, k in enumerate((2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5)):
        a = seg(R_BACK, k)
        start = X_BACK + 0.4 + (2.5 if j in (3, 6) else 0)
        arc_panel(kit, f"back_stringer{j}", start, X_JOINT, a - 0.04, a + 0.04, R_BACK + 0.05, CZ, "rust_dark", thick=0.4, dent_by=0.05)
    # A few plates left on the far (+Y) side, seen through the open near side, and one on the near side low down.
    plates = (
        (-12.0, 1, 3, "plate_dark"),
        (-9.4, 2, 3, "plate"),
        (-6.8, 1, 2, "plate_dark"),
        (-4.2, 2, 4, "plate"),
        (-9.4, 9, 2, "streak"),
        (-6.8, 8, 2, "plate"),
        (-4.2, 6, 2, "plate_dark"),
    )
    for j, (x0, k, span, mat) in enumerate(plates):
        arc_panel(kit, f"back_plate{j}", x0, x0 + 2.4, seg(R_BACK, k), seg(R_BACK, k + span), R_BACK, CZ, mat, thick=0.25, segs=span, tear=0.4, dent_by=0.1)


def front_half(kit: Kit) -> None:
    # Plated bands between the front rings. Steps 5-7 at the top lose a plate here and there.
    bands = ((X_JOINT, 2.0), (2.0, 5.0), (5.0, 8.0), (8.0, 11.5))
    missing = {(1, 6), (2, 5), (2, 6), (3, 7), (0, 7)}
    for b, (x0, x1) in enumerate(bands):
        k = 0
        while k < SEGS:
            run = 1 if (b, k) in missing else min(kit.rng.randint(2, 3), SEGS - k)
            if (b, k) not in missing:
                mat = kit.rng.choices(["plate", "plate_dark", "streak"], weights=[6, 3, 2])[0]
                arc_panel(kit, f"skin{b}_{k}", x0 + 0.05, x1 - 0.05, seg(R_FRONT, k), seg(R_FRONT, k + run), R_FRONT, CZ, mat, thick=0.35, segs=run, tear=0.3, dent_by=0.08)
            k += run
    # Rings proud of the skin, then the heavy flared mouth ring.
    for i, x in enumerate((-0.6, 2.0, 5.0, 8.0, 11.5)):
        ring(kit, f"front_rib{i}", x, R_FRONT, 0.7, "rust" if i % 2 else "rust_side")
    arc_panel(kit, "mouth_ring", 11.6, X_MOUTH, seg(R_FRONT, 0), seg(R_FRONT, SEGS), R_FRONT + 0.2, CZ, "rust", thick=1.0, segs=SEGS, r1=R_MOUTH + 0.2, dent_by=0.06)
    # Rust streaks on the plates, on the ring grid so they lie on the skin.
    for i in range(8):
        k = kit.rng.randrange(1, SEGS - 1)
        x = kit.rng.uniform(0.0, 10.5)
        arc_panel(kit, f"streak{i}", x, x + kit.rng.uniform(0.8, 1.8), seg(R_FRONT, k), seg(R_FRONT, k + 1), R_FRONT + 0.04, CZ, "rust_side", thick=0.06)


def mouth_ladder(kit: Kit) -> None:
    # A ladder leaning inside the mouth against the near wall. Below truck clearance it keeps 4.6 m or more off the axis.
    x = 10.4
    foot, top = (-5.3, 0.0), (-3.6, 6.4)
    for s, dx in (("a", -0.45), ("b", 0.45)):
        strut(kit, f"ladder_rail_{s}", (x + dx, foot[0], foot[1]), (x + dx, top[0], top[1]), 0.14, "rust_dark")
    for i in range(1, 9):
        t = i / 9
        y = foot[0] + (top[0] - foot[0]) * t
        z = foot[1] + (top[1] - foot[1]) * t
        kit.box(f"ladder_rung{i}", (0.9, 0.08, 0.08), (x, y, z), "rust_dark")


def sand(kit: Kit) -> None:
    # A drift heaped against the near side where the halves meet, and low heaps along the buried ring feet.
    # Each heap keeps its inner foot 5 m or more off the axis, clear of the drive line.
    for i, (x, r, h) in enumerate(((-4.0, 2.6, 2.6), (-1.2, 3.0, 3.4), (1.6, 2.6, 2.4))):
        mound(kit, f"drift{i}", r, h, (x, -5.4 - r))
    mound(kit, "drift_far", 2.8, 2.0, (-3.0, 8.4))
    mound(kit, "heap_back", 2.2, 1.2, (-11.0, -7.4))
    # Two plates fallen on the sand outside the walls.
    kit.box("fallen0", (3.2, 2.2, 0.25), (6.5, -9.0, 0.25), "plate", rot=(math.radians(8), math.radians(-5), math.radians(25)), dent_by=0.12)
    kit.box("fallen1", (2.6, 1.8, 0.25), (-7.0, 8.8, 0.3), "streak", rot=(math.radians(-12), 0, math.radians(-30)), dent_by=0.12)


def build(kit: Kit) -> None:
    back_half(kit)
    front_half(kit)
    mouth_ladder(kit)
    sand(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("engine_nozzle", args, view_size=34.0)


if __name__ == "__main__":
    main()
