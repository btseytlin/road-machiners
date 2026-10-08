"""Bowl's crater-floor house (C1): a pale plastered box under a low pitched corrugated roof, with lit windows.

One script writes three roof color variants, picked by the output name: bowl_house_rust.glb, bowl_house_red.glb and
bowl_house_grey.glb.

Built at its in-game size: 8.0 m long along Y, 6.0 m deep along X, eaves at 3.4 m and the ridge, along Y, at 4.6 m.
The roof overhangs the walls by 0.35 m on every side, so the footprint is 8.7 m by 6.7 m. The door and two windows
face +X. Origin at the ground center.
Run: blender --background --python tools/blender/bowl_house.py -- public/models/bowl_house_rust.glb [tmp/bowl_house_rust.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import prism  # noqa: E402

# Colors from src/render/palette.ts. The roof key is filled in per variant.
COLORS = {
    "plaster": 0xB8B8B0,  # FACTION_COLORS.convoys.top, C1's pale plaster walls
    "plinth": 0x9A8A78,  # PAL.rock.top
    "door": 0x6A4A2A,  # PAL.trunk
    "frame": 0x5E3420,  # PAL.rust.side, window frames and shutters
    "glow": 0xFFF2C8,  # PAL.lamp.on, lit windows and the porch lamp
}
ROOFS = {
    "rust": (0x8A4A2A, 0x5E3420),  # PAL.rust.top, ribs PAL.rust.side
    "red": (0x8A3A2A, 0x5E3420),  # PAL.roof[2], ribs PAL.rust.side
    "grey": (0x8A8A84, 0x5A5A58),  # PAL.metalLight, ribs PAL.metal
}
SEED = 61

LENGTH = 8.0  # Y
DEPTH = 6.0  # X
EAVE = 3.4
RIDGE = 4.6
OVERHANG = 0.35
SLAB = 0.14  # roof sheet thickness
PLINTH = 0.3
RIB_GAP = 0.9  # m between corrugation ribs along Y
WINDOW = (0.9, 0.9)  # width, height
SILL = 1.2


def variant(out: Path) -> str:
    """The roof variant named by the output file, bowl_house_<variant>.glb."""
    name = out.stem.removeprefix("bowl_house_")
    if name not in ROOFS:
        raise ValueError(f"{out.name} names no roof variant. Known: {sorted(ROOFS)}")
    return name


def roof(kit: Kit) -> None:
    """Two sloped sheets meeting at the ridge, with ribs across them, and the gable fills under them."""
    half = DEPTH / 2 + OVERHANG
    rise = RIDGE - EAVE
    pitch = math.atan2(rise, DEPTH / 2)
    run = half / math.cos(pitch)
    length = LENGTH + 2 * OVERHANG
    for side in (-1, 1):
        x = side * half / 2
        z = EAVE + rise * (1 - (half / 2) / (DEPTH / 2)) + SLAB / 2
        kit.box(f"roof{side:+d}", (run, length, SLAB), (x, 0, z), "roof", rot=(0, side * pitch, 0), dent_by=0.03)
        for i in range(int(length / RIB_GAP) + 1):
            y = -length / 2 + 0.15 + i * (length - 0.3) / int(length / RIB_GAP)
            kit.box(f"rib{side:+d}_{i}", (run, 0.08, 0.06), (x, y, z + SLAB / 2 + 0.02), "rib", rot=(0, side * pitch, 0))
    kit.box("ridge", (0.35, length, 0.12), (0, 0, RIDGE + SLAB + 0.02), "rib")
    gable = [(-DEPTH / 2, EAVE), (DEPTH / 2, EAVE), (0, RIDGE)]
    prism(kit, "gables", gable, -LENGTH / 2, LENGTH / 2, "plaster")


def window(kit: Kit, name: str, x: float, y: float, facing_x: bool) -> None:
    """A lit pane with a dark frame on a wall face. facing_x: on a +-X face, else on a +-Y face."""
    w, h = WINDOW
    z = SILL + h / 2
    if facing_x:
        kit.box(f"{name}_frame", (0.06, w + 0.2, h + 0.2), (x, y, z), "frame")
        kit.box(f"{name}_pane", (0.08, w, h), (x + math.copysign(0.02, x), y, z), "glow")
    else:
        kit.box(f"{name}_frame", (w + 0.2, 0.06, h + 0.2), (x, y, z), "frame")
        kit.box(f"{name}_pane", (w, 0.08, h), (x, y + math.copysign(0.02, y), z), "glow")


def build(kit: Kit) -> None:
    kit.box("plinth", (DEPTH + 0.2, LENGTH + 0.2, PLINTH + 0.4), (0, 0, (PLINTH - 0.4) / 2), "plinth", dent_by=0.03)
    kit.box("walls", (DEPTH, LENGTH, EAVE), (0, 0, EAVE / 2), "plaster", dent_by=0.02)
    roof(kit)
    front = DEPTH / 2 + 0.03
    # The door, with a lamp over it, sits right of the middle; one window either side of it.
    kit.box("door", (0.08, 1.1, 2.2), (front, 0.9, 1.1), "door")
    kit.box("lamp", (0.2, 0.25, 0.2), (front + 0.08, 0.9, 2.55), "glow")
    for i, y in enumerate((-2.2, 2.6)):
        window(kit, f"front{i}", front, y, True)
    for i, y in enumerate((-2.0, 2.0)):
        window(kit, f"back{i}", -front, y, True)
    window(kit, "side", 0.8, LENGTH / 2 + 0.03, False)
    window(kit, "end", -0.8, -LENGTH / 2 - 0.03, False)


def main() -> None:
    args = parse_args()
    top, rib = ROOFS[variant(args.out)]
    kit = Kit({**COLORS, "roof": top, "rib": rib}, SEED)
    build(kit)
    kit.export(args.out.stem, args, view_size=14.0)


if __name__ == "__main__":
    main()
