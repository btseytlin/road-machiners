"""Fortress wall in the patchwork style (C1, Bowl). tools/blender/fort_patchwork_kit.py gives its size and origin.

Run: blender --background --python tools/blender/fort_patchwork_wall.py -- public/models/fort_patchwork_wall.glb [tmp/fort_patchwork_wall.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fort_patchwork_kit import run  # noqa: E402

if __name__ == "__main__":
    run("wall")
