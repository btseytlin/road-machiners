"""Fortress gate in the yard style (C4, Salvage Yard). tools/blender/fort_yard_kit.py gives its size and origin.

Run: blender --background --python tools/blender/fort_yard_gate.py -- public/models/fort_yard_gate.glb [tmp/fort_yard_gate.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fort_yard_kit import run  # noqa: E402

if __name__ == "__main__":
    run("gate")
