"""Claymore ram for the 'claymoreRam' armor: a ram plate with boxy charge packs bolted to its face.

A front-edge row of 3 cells: 1.45 m across, 0.65 m deep, outer face at +X. Two push arms carry an upright ram plate
in front of the row. Four charge packs sit on its face out to X = 0.86 m, wired together along the top. The plate
takes the faction paint. The packs are olive drab with mustard fuze caps, the utility hint.
Run: blender --background --python tools/blender/arm_claymore_ram.py -- public/models/arm_claymore_ram.glb [tmp/arm_claymore_ram.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_armor import COLORS, OUTER_X, PREVIEW_M, check_fit, half_span, spread  # noqa: E402
from shapes import strut  # noqa: E402

N = 3
SEED = 39
PLATE_X = 0.6
PLATE_Z = 0.36
PLATE_H = 0.5
PACK = (0.14, 0.24, 0.2)
REACH = 0.88
CLAYMORE_COLORS = {
    **COLORS,
    "mustard": 0xB39A3A,  # PAL.utility
}


def build(kit: Kit) -> None:
    half = half_span(N)
    kit.box("mount_plate", (0.08, half * 2 - 0.1, 0.5), (OUTER_X - 0.05, 0, 0.3), "metal", dent_by=0.006)
    kit.box("mount_foot", (0.3, half * 2 - 0.1, 0.05), (OUTER_X - 0.18, 0, 0.025), "metal")
    for y in (-half * 0.6, half * 0.6):
        kit.box(f"arm{y:.2f}", (PLATE_X - OUTER_X + 0.1, 0.1, 0.12), ((PLATE_X + OUTER_X) / 2, y, PLATE_Z + 0.08), "metal")
        strut(kit, f"arm_low{y:.2f}", (OUTER_X, y, 0.12), (PLATE_X, y, PLATE_Z - 0.14), 0.07, "metal")
    kit.box("plate", (0.08, half * 2 - 0.02, PLATE_H), (PLATE_X, 0, PLATE_Z), "paint", dent_by=0.008)
    kit.box("plate_top", (0.12, half * 2, 0.05), (PLATE_X, 0, PLATE_Z + PLATE_H / 2), "metal_light", dent_by=0.004)
    kit.box("plate_foot", (0.12, half * 2 - 0.1, 0.06), (PLATE_X, 0, PLATE_Z - PLATE_H / 2), "dark")
    # Four charge packs on the face, each strapped on with a fuze cap on top.
    pack_x = PLATE_X + 0.04 + PACK[0] / 2
    ys = spread(4, half - 0.2)
    for i, y in enumerate(ys):
        kit.box(f"pack{i}", PACK, (pack_x, y, PLATE_Z), "sign_green", dent_by=0.006)
        kit.box(f"strap{i}", (PACK[0] + 0.02, PACK[1] + 0.02, 0.03), (pack_x, y, PLATE_Z - 0.04), "dark")
        kit.box(f"fuze{i}", (0.06, 0.06, 0.05), (pack_x - 0.02, y, PLATE_Z + PACK[2] / 2 + 0.025), "mustard")
    # One wire chains the fuzes back to the mount.
    kit.box("wire", (0.02, ys[-1] - ys[0], 0.02), (pack_x - 0.02, 0, PLATE_Z + PACK[2] / 2 + 0.06), "dark")
    strut(kit, "wire_back", (pack_x - 0.02, ys[0], PLATE_Z + PACK[2] / 2 + 0.06), (OUTER_X - 0.02, ys[0] + 0.05, 0.5), 0.02, "dark")


def main() -> None:
    args = parse_args()
    kit = Kit(CLAYMORE_COLORS, SEED)
    build(kit)
    check_fit("arm_claymore_ram", N, REACH)
    kit.export("arm_claymore_ram", args, view_size=PREVIEW_M)


if __name__ == "__main__":
    main()
