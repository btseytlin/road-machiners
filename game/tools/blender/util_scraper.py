"""Scraper's knife: a tool rack holding a long cutting blade and a pry bar over a mustard tool box, for scrapersKnife.

Footprint is one cell across by two along, 0.484 m by 1.3 m. Two end frames 0.5 m tall hold the blade and the bar
lengthwise. The blade is bright worn steel with a dark spine, the bar has a rusty hooked end, and the tool box under
them is mustard for the utility kind.
Run: blender --background --python tools/blender/util_scraper.py -- public/models/util_scraper.glb [tmp/util_scraper.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_core import ALONG_X  # noqa: E402
from shapes import strut  # noqa: E402
from util_common import run  # noqa: E402

SEED = 408
FRAME_XS = (-0.48, 0.48)
FRAME_H = 0.5
BLADE_Z = 0.42
BAR_Z = 0.3


def build(kit: Kit) -> None:
    kit.box("base", (1.24, 0.44, 0.04), (0, 0, 0.02), "metal_dark")
    for x in FRAME_XS:
        for y in (-0.18, 0.18):
            strut(kit, f"upright{x}{y}", (x, y, 0.04), (x, y, FRAME_H), 0.045, "metal", dent_by=0.003)
        kit.box(f"top_bar{x}", (0.05, 0.42, 0.04), (x, 0, FRAME_H), "metal")
        # Hooks the blade and the bar rest in.
        kit.box(f"blade_hook{x}", (0.06, 0.04, 0.12), (x, 0.08, BLADE_Z - 0.04), "metal_dark")
        kit.box(f"bar_hook{x}", (0.06, 0.04, 0.08), (x, -0.1, BAR_Z - 0.04), "metal_dark")
    # The long blade: a flat steel strip stood on edge, its dark spine on top and a wrapped grip at the back.
    kit.box("blade", (1.0, 0.025, 0.16), (0.04, 0.08, BLADE_Z), "metal_light", dent_by=0.004)
    kit.box("spine", (1.0, 0.04, 0.03), (0.04, 0.08, BLADE_Z + 0.09), "metal_dark")
    kit.box("blade_tip", (0.1, 0.025, 0.1), (0.57, 0.08, BLADE_Z - 0.02), "metal_light", rot=(0, 0.5, 0))
    kit.box("grip", (0.2, 0.05, 0.06), (-0.54, 0.08, BLADE_Z + 0.03), "leather")
    # The pry bar, with its hooked claw at the front.
    kit.cylinder("bar", 0.022, 1.1, (-0.02, -0.1, BAR_Z), "metal", rot=ALONG_X, vertices=6, dent_by=0.003)
    strut(kit, "claw", (0.52, -0.1, BAR_Z), (0.6, -0.1, BAR_Z + 0.08), 0.04, "rust", sides=4)
    kit.box("claw_tip", (0.05, 0.05, 0.03), (0.61, -0.1, BAR_Z + 0.09), "rust_dark")
    # A tool box under the rack.
    kit.box("toolbox", (0.5, 0.32, 0.16), (0.0, 0, 0.12), "mustard", dent_by=0.006)
    kit.box("toolbox_lid", (0.52, 0.34, 0.03), (0.0, 0, 0.215), "metal_dark")
    kit.box("toolbox_handle", (0.2, 0.03, 0.03), (0.0, 0, 0.245), "metal_light")


if __name__ == "__main__":
    run("util_scraper", build, SEED, 1, 2, view=1.8)
