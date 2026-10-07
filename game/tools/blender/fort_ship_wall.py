"""Fortress wall in the ship metal style (C5, Nose). tools/blender/fort_ship_kit.py gives its size and origin.

Run: blender --background --python tools/blender/fort_ship_wall.py -- public/models/fort_ship_wall.glb [tmp/fort_ship_wall.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fort_ship_kit import run  # noqa: E402

if __name__ == "__main__":
    run("wall")
