"""Salvage Yard's crane base (C4): a round concrete turret on a low skirt, banded with plates and streaked with rust,
with a ladder, and a steel king-post pedestal topped by the slew ring. The slewing crane_upper attaches at
socket_slew.

Built at its in-game size. The origin is the ground center. The skirt is 3.2 m in radius and 0.5 m tall, the drum
2.6 m in radius up to 2.2 m, and the pedestal 1.25 m in radius up to the slew ring top at 8.5 m, where socket_slew
marks the slew axis. The ladder climbs the +X side of the drum.
Run: blender --background --python tools/blender/crane_base.py -- public/models/crane_base.glb [tmp/crane_base.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import ladder, taper, wall_patches  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "concrete": 0xB8B8B0,  # FACTION_COLORS.convoys.top, C4's pale turret
    "concrete_b": 0x86867E,  # FACTION_COLORS.convoys.side
    "plinth": 0x6E6254,  # PAL.rock.side
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "metal": 0x5A5A58,  # PAL.metal
    "steel": 0x2A2420,  # PAL.wheel, the dark pedestal
}
SEED = 81

SKIRT = (3.2, 0.5)  # radius, height
DRUM = (2.6, 2.2)  # radius, top
PEDESTAL = (1.25, 8.2)  # radius, top
RING = (1.5, 0.3)  # slew ring radius, thickness
SIDES = 14


def build(kit: Kit) -> None:
    skirt = kit.cylinder("skirt", SKIRT[0], SKIRT[1] + 0.3, (0, 0, SKIRT[1] / 2 - 0.15), "plinth", vertices=SIDES, dent_by=0.04)
    taper(skirt, DRUM[0] / SKIRT[0] + 0.05)
    drum = kit.cylinder("drum", DRUM[0], DRUM[1], (0, 0, DRUM[1] / 2), "concrete", vertices=SIDES, dent_by=0.03)
    wall_patches(kit, "streak", drum, 5, (0.9, 1.6), ["rust_side", "concrete_b", "rust"])
    for i, z in enumerate((0.7, DRUM[1] - 0.15)):
        kit.cylinder(f"band{i}", DRUM[0] + 0.05, 0.2, (0, 0, z), "concrete_b", vertices=SIDES)
    kit.cylinder("cap", DRUM[0] - 0.2, 0.3, (0, 0, DRUM[1] + 0.1), "concrete_b", vertices=SIDES)
    # The pedestal: a dark steel column with four gusset ribs, and the slew ring at its top.
    base = DRUM[1] + 0.2
    kit.cylinder("pedestal", PEDESTAL[0], PEDESTAL[1] - base, (0, 0, (base + PEDESTAL[1]) / 2), "steel", vertices=10, dent_by=0.02)
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        r = PEDESTAL[0] + 0.25
        kit.box(f"gusset{i}", (0.6, 0.12, 1.8), (r * math.cos(a), r * math.sin(a), base + 0.9), "rust_dark", rot=(0, 0, a))
    for i, z in enumerate((base + 2.0, PEDESTAL[1] - 1.2)):
        kit.cylinder(f"collar{i}", PEDESTAL[0] + 0.15, 0.25, (0, 0, z), "metal", vertices=10)
    kit.cylinder("ring", RING[0], RING[1], (0, 0, PEDESTAL[1] + RING[1] / 2), "metal", vertices=12)
    for i in range(8):
        a = i * math.pi / 4
        kit.box(f"bolt{i}", (0.15, 0.15, 0.12), ((RING[0] - 0.1) * math.cos(a), (RING[0] - 0.1) * math.sin(a), PEDESTAL[1] + RING[1] + 0.03), "rust_dark")
    ladder(kit, "ladder", (DRUM[0] + 0.2, 0.0, 0.1), DRUM[1] + 0.4, 0.5, 0.0, "rust_dark")
    # Grease drums and a toolbox at the foot.
    kit.cylinder("drum_oil", 0.3, 0.9, (-1.6, 2.5, 0.45), "rust", vertices=8, dent_by=0.02)
    kit.box("toolbox", (0.9, 0.5, 0.5), (-2.4, -1.8, 0.25), "rust_side", rot=(0, 0, 0.6), dent_by=0.02)
    kit.socket("slew", (0.0, 0.0, PEDESTAL[1] + RING[1]))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("crane_base", args, view_size=9.0)


if __name__ == "__main__":
    main()
