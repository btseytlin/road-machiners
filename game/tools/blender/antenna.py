"""Whip radio antenna on a truck cab roof.

1.6 m tall along Z with the origin at the mount foot, where the view hinges it.
The view bends it back and to the side as the truck speeds up, brakes and turns.
Run: blender --background --python tools/blender/antenna.py -- public/models/antenna.glb [tmp/antenna.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS  # noqa: E402
from shapes import taper  # noqa: E402

SEED = 105
HEIGHT = 1.6


def build(kit: Kit) -> None:
    kit.box("foot", (0.14, 0.14, 0.06), (0, 0, 0.03), "metal_dark")
    kit.cylinder("spring", 0.04, 0.14, (0, 0, 0.13), "metal", vertices=6)
    whip = kit.cylinder("whip", 0.018, HEIGHT - 0.2, (0, 0, 0.2 + (HEIGHT - 0.2) / 2), "metal_light", vertices=4)
    taper(whip, 0.5)
    kit.box("flag", (0.12, 0.01, 0.08), (-0.07, 0, HEIGHT - 0.06), "red")
    kit.cylinder("bulb", 0.04, 0.08, (0, 0, HEIGHT - 0.01), "radio_light", vertices=6)


def main() -> None:
    args = parse_args()
    # radio_light is PAL.radioLight.off in src/render/palette.ts; the view swaps it for its own material.
    kit = Kit({**COLORS, "radio_light": 0x4A1A14}, SEED)
    build(kit)
    kit.export("antenna", args, view_size=2.0)


if __name__ == "__main__":
    main()
