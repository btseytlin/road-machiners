"""Escape pod: a small capsule with its nose dug into the sand, hatch open and a beacon window glowing.

Sized to a 2.4 m reference radius: about 4.5 m long and 2.4 m across, low enough to see over.
Built of closed boxes and cylinders, so its collision shape can be read from it.
Run: blender --background --python tools/blender/escape_pod.py -- public/models/escape_pod.glb [tmp/escape_pod.png]
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
SEED = 61


def build(kit: Kit) -> None:
    tilt = math.radians(-12)
    # The hull, a short cylinder lying along x with its nose dug in at +x.
    kit.cylinder("hull", 1.2, 4.2, (0, 0, 1.2), "metal_light", rot=(0, math.radians(90) + tilt, 0), vertices=8, dent_by=0.06)
    kit.cylinder("tail_ring", 1.0, 0.5, (-2.1, 0, 1.55), "rust", rot=(0, math.radians(90) + tilt, 0), vertices=8)
    # The open hatch hanging off the side, and the beacon window above it.
    kit.box("hatch", (1.3, 0.12, 1.0), (-0.3, 1.45, 1.3), "rust_dark", rot=(0, 0, math.radians(35)))
    kit.box("beacon", (0.7, 0.3, 0.45), (0.5, 0, 2.2), "ship_glow")
    # A scorched fin.
    kit.box("fin", (1.2, 0.15, 0.9), (-1.5, 0, 2.3), "rust_dark", rot=(0, tilt, 0))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("escape_pod", args, view_size=8.0)


if __name__ == "__main__":
    main()
