"""Fortress tower in the ship style. tools/blender/fort_kit.py gives its size and origin.

Run: blender --background --python tools/blender/fort_ship_tower.py -- public/models/fort_ship_tower.glb [tmp/fort_ship_tower.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fort_kit import run  # noqa: E402

if __name__ == "__main__":
    run("ship", "tower")
