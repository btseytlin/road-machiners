"""Nose's small jib crane (C5): a lattice mast on a concrete pad, a jib with a counterweight and a tie from the mast
head, and a crate hanging from the jib tip. It stands still; the Salvage Yard crane is the one that moves.

Built at its in-game size: the mast is 1.2 m square and 9.5 m tall, the mast head reaches 12 m, the jib runs 7 m
out along +X at 9.5 m and the counterweight 2.5 m back. The 1.6 m crate hangs on its cable 3 m over the ground.
Origin at the ground center of the mast.
Run: blender --background --python tools/blender/jib_crane.py -- public/models/jib_crane.glb [tmp/jib_crane.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "pad": 0x9A8A78,  # PAL.rock.top
    "steel": 0x3A2418,  # PAL.rust.dark, C5's dark lattice
    "lace": 0x5E3420,  # PAL.rust.side
    "weight": 0x5A5A58,  # PAL.metal
    "crate": 0x9A7A4A,  # PAL.crate
    "band": 0x6A4A2A,  # PAL.trunk
}
SEED = 30

HALF = 0.6
MAST = 9.5
HEAD = 12.0
JIB = 7.0
BACK = 2.5
CRATE = 1.6
CRATE_Z = 3.0
CORNERS = ((1, 1), (-1, 1), (-1, -1), (1, -1))


def build(kit: Kit) -> None:
    kit.box("pad", (3.0, 3.0, 0.6), (0, 0, 0.1), "pad")
    for i, (cx, cy) in enumerate(CORNERS):
        strut(kit, f"chord{i}", (cx * HALF, cy * HALF, 0.3), (cx * HALF, cy * HALF, MAST), 0.16, "steel")
    bays = 6
    for b in range(bays):
        z0, z1 = 0.4 + b * (MAST - 0.4) / bays, 0.4 + (b + 1) * (MAST - 0.4) / bays
        for i, (c0, c1) in enumerate(zip(CORNERS, CORNERS[1:] + CORNERS[:1])):
            a = (c0[0] * HALF, c0[1] * HALF, z0)
            e = (c1[0] * HALF, c1[1] * HALF, z1)
            strut(kit, f"lace{b}_{i}", a, e, 0.07, "lace")
            strut(kit, f"ring{b}_{i}", (c0[0] * HALF, c0[1] * HALF, z1), (c1[0] * HALF, c1[1] * HALF, z1), 0.07, "lace")
    kit.box("slew", (1.6, 1.6, 0.4), (0, 0, MAST + 0.2), "weight")
    strut(kit, "head", (0, 0, MAST + 0.4), (0, 0, HEAD), 0.25, "steel")
    for side in (-1, 1):
        strut(kit, f"jib{side}", (0, side * 0.35, MAST + 0.5), (JIB, side * 0.2, MAST + 0.5), 0.14, "steel")
        strut(kit, f"tie{side}", (0, side * 0.1, HEAD), (JIB * 0.9, side * 0.2, MAST + 0.6), 0.06, "steel")
    for k in range(5):
        x0, x1 = JIB * k / 5, JIB * (k + 1) / 5
        strut(kit, f"jib_lace{k}", (x0, -0.3, MAST + 0.5), (x1, 0.3, MAST + 0.5), 0.05, "lace")
    strut(kit, "counter_jib", (0, 0, MAST + 0.5), (-BACK, 0, MAST + 0.5), 0.2, "steel")
    strut(kit, "counter_tie", (0, 0, HEAD), (-BACK + 0.4, 0, MAST + 0.6), 0.06, "steel")
    kit.box("weight", (1.0, 1.0, 1.0), (-BACK + 0.4, 0, MAST), "weight", dent_by=0.03)
    strut(kit, "cable", (JIB - 0.3, 0, MAST + 0.4), (JIB - 0.3, 0, CRATE_Z + CRATE), 0.05, "weight")
    kit.box("crate", (CRATE, CRATE, CRATE), (JIB - 0.3, 0, CRATE_Z + CRATE / 2), "crate", dent_by=0.03)
    for dz in (0.3, CRATE - 0.3):
        kit.box(f"crate_band{dz:.1f}", (CRATE + 0.04, CRATE + 0.04, 0.12), (JIB - 0.3, 0, CRATE_Z + dz), "band")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("jib_crane", args, view_size=18)


if __name__ == "__main__":
    main()
