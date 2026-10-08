"""Fortress inner in the cistern style. tools/blender/fort_cistern_kit.py gives its size and origin.

Run: blender --background --python tools/blender/fort_cistern_inner.py -- public/models/fort_cistern_inner.glb [tmp/fort_cistern_inner.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fort_cistern_kit import run  # noqa: E402

if __name__ == "__main__":
    run("inner")
