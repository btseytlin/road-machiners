"""Fortress wall in the ring style (C3, Granary). tools/blender/fort_ring_kit.py gives its size and origin.

Run: blender --background --python tools/blender/fort_ring_wall.py -- public/models/fort_ring_wall.glb [tmp/fort_ring_wall.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fort_ring_kit import run  # noqa: E402

if __name__ == "__main__":
    run("wall")
