"""Habitat cylinder: a ring-ribbed living module lying on its side, one end torn open.

Sized to an 8 m reference radius: about 16 m long and 7 m across, tall enough to block sight.
Built of closed boxes and cylinders, so its collision shape can be read from it.
Run: blender --background --python tools/blender/habitat_cylinder.py -- public/models/habitat_cylinder.glb [tmp/habitat_cylinder.png]
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
SEED = 62


def build(kit: Kit) -> None:
    # The shell, lying along x, with ring ribs standing out of it.
    kit.cylinder("shell", 3.4, 13.0, (-1.5, 0, 3.4), "metal", rot=(0, math.radians(90), 0), vertices=10, dent_by=0.1)
    for k in range(5):
        kit.cylinder(f"rib_{k}", 3.6, 0.5, (-6.5 + k * 2.8, 0, 3.4), "metal_light", rot=(0, math.radians(90), 0), vertices=10)
    # The torn end at +x: a short ragged collar and a rust-dark gap.
    kit.cylinder("collar", 3.0, 2.5, (6.75, 0, 3.0), "rust", rot=(0, math.radians(90), math.radians(8)), vertices=7)
    kit.box("spar", (2.4, 0.3, 3.0), (7.2, 1.8, 3.8), "rust_dark", rot=(0, 0, math.radians(12)))
    # The capped end at -x and a window strip.
    kit.cylinder("cap", 2.4, 1.0, (-8.3, 0, 3.0), "rust_dark", rot=(0, math.radians(90), 0), vertices=8)
    kit.box("windows", (6.0, 0.2, 0.5), (-2.0, 3.45, 4.2), "ship_glow")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("habitat_cylinder", args, view_size=22.0)


if __name__ == "__main__":
    main()
