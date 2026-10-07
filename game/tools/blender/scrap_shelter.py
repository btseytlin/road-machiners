"""Nose's small scrap shelters (C5): a box of pale salvaged plates on a low plinth with a dark plate door and a lamp over it.

One script writes two roof variants, picked by the output name: scrap_shelter_flat.glb has a flat plated roof with
a lip, and scrap_shelter_lean.glb a corrugated tin roof that leans down to the back.

Built at its in-game size: 6.0 m deep along X and 8.0 m long along Y, 3.6 m to the flat roof's lip (the lean roof
runs from 4.2 m at the front to 3.2 m at the back and overhangs 0.4 m). The doorway, 1.4 m wide and 2.2 m tall, and
its lamp face +X. Origin at the ground center.
Run: blender --background --python tools/blender/scrap_shelter.py -- public/models/scrap_shelter_flat.glb [tmp/scrap_shelter_flat.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts. C5's shelters are pale grey-beige plate boxes.
COLORS = {
    "pale": 0xB8B8B0,  # FACTION_COLORS.convoys.top
    "bone": 0xC8B89A,  # FACTION_COLORS.vultures.cab
    "grey": 0x86867E,  # FACTION_COLORS.convoys.side
    "plinth": 0x9A8A78,  # PAL.rock.top
    "frame": 0x5A5A58,  # PAL.metal
    "door": 0x3A2418,  # PAL.rust.dark, the door and the shutter
    "roof": 0x7A6A4A,  # FACTION_COLORS.scavengers.top, the lean roof's weathered tin
    "rib": 0x5E3420,  # PAL.rust.side
    "glow": 0xFFF2C8,  # PAL.lamp.on, the lamp
}
SEED = 28

DEPTH = 6.0  # X
LENGTH = 8.0  # Y
WALL = 3.4
DOOR = (1.4, 2.2)
DOOR_Y = -1.6


def variant(out: Path) -> str:
    name = out.stem
    if name not in ("scrap_shelter_flat", "scrap_shelter_lean"):
        raise ValueError(f"scrap_shelter.py writes scrap_shelter_flat or scrap_shelter_lean, not {name}")
    return name.rsplit("_", 1)[1]


def body(kit: Kit) -> None:
    kit.box("plinth", (DEPTH + 0.3, LENGTH + 0.3, 0.5), (0, 0, 0.0), "plinth")
    kit.box("core", (DEPTH, LENGTH, WALL), (0, 0, WALL / 2), "grey")
    # Plates proud of the long faces and the ends, in two pale shades, 2 m wide.
    for side in (-1, 1):
        for i in range(4):
            y = -LENGTH / 2 + 1 + i * 2
            if side == 1 and abs(y - DOOR_Y) < 1.2:
                continue
            kit.box(f"plate{side}_{i}", (0.08, 1.9, WALL - 0.3), (side * (DEPTH / 2 + 0.03), y, WALL / 2 + 0.1), kit.rng.choice(("pale", "bone", "pale")), dent_by=0.03)
        for i in range(3):
            x = -DEPTH / 2 + 1 + i * 2
            kit.box(f"end{side}_{i}", (1.9, 0.08, WALL - 0.3), (x, side * (LENGTH / 2 + 0.03), WALL / 2 + 0.1), kit.rng.choice(("pale", "bone")), dent_by=0.03)
    # The doorway: a steel frame round a shut plate door, and a lamp over it.
    x = DEPTH / 2 + 0.06
    kit.box("door_frame", (0.12, DOOR[0] + 0.4, DOOR[1] + 0.25), (x, DOOR_Y, (DOOR[1] + 0.25) / 2), "frame")
    kit.box("doorway", (0.16, DOOR[0], DOOR[1]), (x + 0.02, DOOR_Y, DOOR[1] / 2), "door")
    kit.box("lamp", (0.3, 0.3, 0.25), (x + 0.15, DOOR_Y, DOOR[1] + 0.55), "glow")
    kit.box("shutter", (0.1, 1.2, 0.9), (x, 1.6, 1.8), "door")


def flat_roof(kit: Kit) -> None:
    kit.box("roof", (DEPTH + 0.3, LENGTH + 0.3, 0.25), (0, 0, WALL + 0.12), "grey", dent_by=0.03)
    kit.box("roof_top", (DEPTH - 0.4, LENGTH - 0.4, 0.15), (0, 0, WALL + 0.3), "pale", dent_by=0.02)


def lean_roof(kit: Kit) -> None:
    front, back = 4.2, 3.2
    slope = math.atan2(front - back, DEPTH + 0.8)
    mid = (front + back) / 2
    kit.box("gable_fill", (DEPTH, LENGTH, front - WALL), (0, 0, WALL + (front - WALL) / 2 - 0.4), "grey")
    kit.box("roof", (DEPTH + 0.8, LENGTH + 0.8, 0.12), (0, 0, mid + 0.06), "roof", rot=(0, -slope, 0), dent_by=0.03)
    for i in range(6):
        y = -LENGTH / 2 + 0.3 + i * (LENGTH - 0.6) / 5
        kit.box(f"rib{i}", (DEPTH + 0.8, 0.1, 0.08), (0, y, mid + 0.15), "rib", rot=(0, -slope, 0))


def main() -> None:
    args = parse_args()
    kind = variant(args.out)
    kit = Kit(COLORS, SEED)
    body(kit)
    flat_roof(kit) if kind == "flat" else lean_roof(kit)
    kit.export(args.out.stem, args, view_size=12)


if __name__ == "__main__":
    main()
