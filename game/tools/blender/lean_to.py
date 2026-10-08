"""Granary open shelter (C3): a grey and rust corrugated roof sloping from the back down to the open front on six
timber posts, with boarding across the lower back and a lit lamp hung under the front beam.

Built at its in-game size: 8 m wide along Y and 5 m deep along X, the roof 5 m high at the back (-X) and 3.8 m at
the front (+X), a little taller than C3's so it shows over the 12 m ring, overhanging by 0.3 m. The open side faces
+X. Origin at the ground center.
Run: blender --background --python tools/blender/lean_to.py -- public/models/lean_to.glb [tmp/lean_to.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "roof": 0x8A4A2A,  # PAL.rust.top
    "roof_side": 0x5E3420,  # PAL.rust.side
    "tin": 0x8A8A84,  # PAL.metalLight
    "wood": 0x6A4A2A,  # PAL.trunk
    "board": 0x8E7454,  # PAL.wall.side
    "metal": 0x5A5A58,  # PAL.metal
    "glow": 0xFFF2C8,  # PAL.lamp.on
}
SEED = 97

WIDTH = 8.0  # Y
DEPTH = 5.0  # X
HIGH = 5.0  # roof at the back
LOW = 3.8  # roof at the front
OVERHANG = 0.3
SHEETS = 8


def roof_at(x: float) -> float:
    """Roof underside height at X, falling from the back (-X) to the front (+X)."""
    return HIGH + (LOW - HIGH) * (x + DEPTH / 2) / DEPTH


def build(kit: Kit) -> None:
    for i, y in enumerate((-WIDTH / 2 + 0.2, 0.0, WIDTH / 2 - 0.2)):
        for side, x in (("b", -DEPTH / 2 + 0.2), ("f", DEPTH / 2 - 0.2)):
            top = roof_at(x)
            kit.box(f"post_{side}{i}", (0.22, 0.22, top), (x, y, top / 2), "wood", dent_by=0.02)
    for side, x in (("b", -DEPTH / 2 + 0.2), ("f", DEPTH / 2 - 0.2)):
        kit.box(f"beam_{side}", (0.24, WIDTH, 0.26), (x, 0, roof_at(x) - 0.13), "wood")
    # Corrugated sheets, each a little skewed, with ribs, laid on the slope.
    slope = math.atan2(HIGH - LOW, DEPTH)
    run = (DEPTH + 2 * OVERHANG) / math.cos(slope)
    for i in range(SHEETS):
        y = -WIDTH / 2 - OVERHANG + (i + 0.5) * (WIDTH + 2 * OVERHANG) / SHEETS
        mat = kit.rng.choice(["tin", "tin", "roof", "roof_side"])  # C3: grey corrugated sheets with rusty ones between
        lift = kit.rng.uniform(0.0, 0.04)
        kit.box(f"sheet{i}", (run, (WIDTH + 2 * OVERHANG) / SHEETS + 0.05, 0.06), (0, y, (HIGH + LOW) / 2 + 0.03 + lift), mat, rot=(0, slope, 0), dent_by=0.03)
        kit.box(f"sheet_rib{i}", (run, 0.06, 0.05), (0, y, (HIGH + LOW) / 2 + 0.09 + lift), "roof_side", rot=(0, slope, 0))
    # Boards across the lower back, with gaps.
    for k in range(4):
        z = 0.35 + k * 0.42
        kit.box(f"board{k}", (0.06, WIDTH - 0.4, 0.3), (-DEPTH / 2 + 0.1, 0, z), "board", rot=(kit.rng.uniform(-0.02, 0.02), 0, 0), dent_by=0.02)
    # A lamp hung under the front beam, lit.
    lx = DEPTH / 2 - 0.5
    kit.box("lamp_wire", (0.03, 0.03, 0.5), (lx, 0.6, roof_at(lx) - 0.25), "metal")
    kit.box("lamp_hood", (0.4, 0.4, 0.12), (lx, 0.6, roof_at(lx) - 0.55), "metal")
    kit.box("lamp", (0.26, 0.26, 0.22), (lx, 0.6, roof_at(lx) - 0.72), "glow")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("lean_to", args, view_size=10.0)


if __name__ == "__main__":
    main()
