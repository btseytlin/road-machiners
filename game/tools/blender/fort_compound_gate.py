"""Fortress gate in the compound style (C2, Dustwell). tools/blender/fort_compound_kit.py gives its size and origin.

Run: blender --background --python tools/blender/fort_compound_gate.py -- public/models/fort_compound_gate.glb [tmp/fort_compound_gate.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fort_compound_kit import run  # noqa: E402

if __name__ == "__main__":
    run("gate")
