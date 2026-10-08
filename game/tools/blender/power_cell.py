"""Power cell: a cracked canister tipped over, its core exposed and glowing in rings.

Sized to a 1.6 m reference radius: about 3 m long and 1.8 m across.
Built of closed boxes and cylinders, so its collision shape can be read from it.
Run: blender --background --python tools/blender/power_cell.py -- public/models/power_cell.glb [tmp/power_cell.png]
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
SEED = 64


def build(kit: Kit) -> None:
    kit.cylinder("can", 0.9, 2.2, (-0.4, 0, 0.9), "metal", rot=(0, math.radians(90), 0), vertices=8, dent_by=0.05)
    # Glowing bands around the can, so the glow shows from any side.
    for k, x in enumerate((-1.0, -0.2)):
        kit.cylinder(f"band_{k}", 0.96, 0.18, (x, 0, 0.9), "ship_glow", rot=(0, math.radians(90), 0), vertices=8)
    kit.cylinder("base", 1.0, 0.3, (-1.6, 0, 0.95), "rust_dark", rot=(0, math.radians(90), 0), vertices=8)
    # The core, exposed where the can split.
    kit.cylinder("core", 0.6, 1.0, (1.0, 0, 0.8), "metal_light", rot=(0, math.radians(90), 0), vertices=8)
    for k in range(3):
        kit.cylinder(f"ring_{k}", 0.68, 0.14, (0.65 + k * 0.35, 0, 0.8), "ship_glow", rot=(0, math.radians(90), 0), vertices=8)
    kit.box("shard", (1.0, 0.1, 0.8), (0.3, 0.85, 1.4), "rust", rot=(math.radians(20), 0, 0))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("power_cell", args, view_size=5.0)


if __name__ == "__main__":
    main()
