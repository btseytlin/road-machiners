"""Salvage Yard's crane grab (C4): an orange hook block on two slack hoist lines, a spreader and four curved claw
tines gripping a rusted pickup. It hangs from crane_upper's socket_hook and hoists 2 m.

Built at its in-game size. The origin is the hook, where the lines meet the hook block. The slack lines run 2 m up
from it, so they always reach crane_upper's fixed lines over the hoist. The pickup hangs with its long axis along Y,
across the boom: 4.4 m long and 1.9 m wide, its wheels 3.3 m below the hook and its roof 1.4 m below it. The tines
reach 1.25 m out along X.
Run: blender --background --python tools/blender/crane_grab.py -- public/models/crane_grab.glb [tmp/crane_grab.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "rust": 0x8A4A2A,  # PAL.rust.top, C4's orange block and the pickup
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "metal": 0x5A5A58,  # PAL.metal
    "steel": 0x2A2420,  # PAL.wheel
    "soot": 0x1A1410,  # PAL.outline, empty window holes
}
SEED = 83

SLACK = 2.1  # the 2 m hoist plus a 0.1 m overlap with the fixed lines
SPREADER_Z = -1.2
CAR_BOTTOM = -3.3
CAR = (1.9, 4.4)  # width along X, length along Y


def claw(kit: Kit) -> None:
    for side in (-1, 1):
        kit.box(f"slack{side}", (0.06, 0.06, SLACK), (0, side * 0.15, SLACK / 2), "metal")
    kit.box("block", (0.7, 0.6, 0.9), (0, 0, -0.45), "rust", dent_by=0.02)
    kit.cylinder("block_sheave", 0.3, 0.7, (0, 0, -0.3), "steel", rot=(0, math.pi / 2, 0), vertices=8)
    kit.box("shank", (0.2, 0.2, 0.4), (0, 0, -1.0), "steel")
    kit.box("spreader", (0.35, 2.6, 0.3), (0, 0, SPREADER_Z), "rust_dark")
    # Four tines: out and down from the spreader ends, then in under the pickup's sills.
    for sx in (-1, 1):
        for sy in (-1, 1):
            y = sy * 1.15
            a = (sx * 0.15, y, SPREADER_Z)
            b = (sx * 1.25, y, SPREADER_Z - 0.6)
            c = (sx * 1.15, y, CAR_BOTTOM + 0.9)
            d = (sx * 0.75, y, CAR_BOTTOM + 0.45)
            for k, (p, q) in enumerate(((a, b), (b, c), (c, d))):
                strut(kit, f"tine{sx}{sy}{k}", p, q, 0.2, "rust_dark" if k else "rust_side")


def pickup(kit: Kit) -> None:
    w, length = CAR
    z0 = CAR_BOTTOM
    wheel_r = 0.38
    kit.box("body", (w - 0.1, length, 0.8), (0, 0, z0 + 0.35 + 0.4), "rust", dent_by=0.04)
    kit.box("cab", (w - 0.2, 1.6, 0.75), (0, -0.25, z0 + 1.15 + 0.37), "rust", dent_by=0.04)
    kit.box("windshield", (w - 0.5, 0.06, 0.45), (0, -1.07, z0 + 1.55), "soot", rot=(math.radians(-20), 0, 0))
    for side in (-1, 1):
        kit.box(f"side_window{side}", (0.06, 1.1, 0.4), (side * (w / 2 - 0.08), -0.25, z0 + 1.55), "soot")
        kit.box(f"bed_rail{side}", (0.08, 1.6, 0.35), (side * (w / 2 - 0.08), 1.35, z0 + 1.3), "rust_side", dent_by=0.03)
    kit.box("hood", (w - 0.2, 1.0, 0.1), (0, -1.65, z0 + 1.18), "rust_side", rot=(math.radians(8), 0, 0), dent_by=0.03)
    kit.box("bumper", (w + 0.1, 0.15, 0.2), (0, -length / 2 - 0.05, z0 + 0.55), "metal")
    kit.box("tailgate", (w - 0.2, 0.08, 0.4), (0, length / 2 + 0.05, z0 + 1.0), "rust_dark", rot=(math.radians(25), 0, 0))
    for sx in (-1, 1):
        for sy in (-1, 1):
            loc = (sx * (w / 2 - 0.1), sy * 1.35, z0 + wheel_r)
            kit.cylinder(f"tire{sx}{sy}", wheel_r, 0.3, loc, "steel", rot=(0, math.pi / 2, 0), vertices=8)


def build(kit: Kit) -> None:
    claw(kit)
    pickup(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("crane_grab", args, view_size=6.0)


if __name__ == "__main__":
    main()
