"""Fortress wall in the masonry style. tools/blender/fort_kit.py gives its size and origin.

Run: blender --background --python tools/blender/fort_masonry_wall.py -- public/models/fort_masonry_wall.glb [tmp/fort_masonry_wall.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fort_kit import run  # noqa: E402

if __name__ == "__main__":
    run("masonry", "wall")
