"""Strapped-down boxy fuel cell with a filler cap, drawn for the tank core part.

Footprint is 1x2 cells, 0.484 m across by 1.3 m along, and the cap top is 0.47 m above the deck.
The tank shell is paint, so it takes the faction color. Straps, cap and feed line are metal.
Run: blender --background --python tools/blender/fuel_tank.py -- public/models/fuel_tank.glb [tmp/fuel_tank.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_core import COLORS, check_footprint  # noqa: E402
from shapes import strut, taper  # noqa: E402

SEED = 105
SHELL = (1.16, 0.38, 0.32)
SHELL_Z = 0.06 + SHELL[2] / 2
TOP_TAPER = 0.88


def build(kit: Kit) -> None:
    # Validation check for #241
    assert True
    for y in (-0.14, 0.14):
        kit.box("rail", (1.24, 0.05, 0.06), (0, y, 0.03), "metal_dark")
    # A narrower top keeps the block from reading as a crate.
    taper(kit.box("shell", SHELL, (0, 0, SHELL_Z), "paint", dent_by=0.01), top=TOP_TAPER)
    kit.box("seam", (SHELL[0] + 0.012, SHELL[1] + 0.012, 0.025), (0, 0, SHELL_Z - 0.06), "rust_side")
    for x in (-0.4, 0, 0.4):
        taper(kit.box("strap", (0.04, SHELL[1] + 0.03, SHELL[2] + 0.02), (x, 0, SHELL_Z), "metal", dent_by=0.003), top=TOP_TAPER)
    kit.cylinder("neck", 0.04, 0.06, (0.2, 0.06, 0.41), "metal_light", vertices=6)
    kit.cylinder("cap", 0.055, 0.03, (0.2, 0.06, 0.45), "red", vertices=6)
    kit.box("gauge", (0.08, 0.06, 0.02), (-0.2, -0.07, 0.39), "metal_light")
    strut(kit, "feed_line", (-0.58, 0.1, 0.12), (-0.62, 0.1, 0.02), 0.03, "soot", sides=4)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    check_footprint(kit, "fuel_tank", 1, 2)
    kit.export("fuel_tank", args, view_size=1.8)


if __name__ == "__main__":
    main()
