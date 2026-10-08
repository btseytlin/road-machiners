"""Wing shard: a torn wing slab with one edge dug in and the tip held high on a lattice of spars.

Sized to a 7 m reference radius: about 14 m by 6 m, the tip about 4.5 m up. Trucks pass under the tip.
Built of closed boxes and cylinders, so its collision shape can be read from it.
Run: blender --background --python tools/blender/wing_shard.py -- public/models/wing_shard.glb [tmp/wing_shard.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "ship_glow": 0x6FE4FF,  # PAL.shipGlow, painted emissive in the view
}
SEED = 63


def build(kit: Kit) -> None:
    # The slab: dug in at -x, rising to a high tip at +x.
    kit.box("slab", (13.5, 6.0, 0.4), (0, 0, 2.6), "metal", rot=(0, math.radians(-17), math.radians(3)), dent_by=0.1)
    kit.box("edge", (13.0, 0.5, 0.5), (0, 2.9, 2.6), "metal_light", rot=(0, math.radians(-17), math.radians(3)))
    # The dug-in root buried in a heap.
    kit.box("root", (2.4, 5.0, 1.2), (-6.2, 0, 0.6), "rust_dark", rot=(0, 0, math.radians(5)))
    # Broken spars under the slab, a lattice that stops short of the ground at the tip.
    for k, x in enumerate((-4.0, -1.0, 2.0)):
        top = 2.6 + (x * 0.3)
        kit.box(f"spar_a_{k}", (0.3, 0.3, top), (x, -1.5, top / 2 - 0.2), "rust", rot=(math.radians(8), 0, 0))
        kit.box(f"spar_b_{k}", (0.3, 0.3, top), (x, 1.5, top / 2 - 0.2), "rust", rot=(math.radians(-8), 0, 0))
    kit.box("brace", (4.0, 0.2, 0.2), (-1.5, 0, 2.0), "rust_dark")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("wing_shard", args, view_size=20.0)


if __name__ == "__main__":
    main()
