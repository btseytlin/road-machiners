"""Bowl's windmill wheel (C1): sixteen sheet blades on two rings around a hub. It turns about +X.

Built at its in-game size, radius 2.4 m, in the YZ plane. The origin is the spin axis at the hub, which attaches at
windmill_tower's socket_rotor. The blades face +X, so the wheel's front faces the way the tower's head does.
Run: blender --background --python tools/blender/windmill_rotor.py -- public/models/windmill_rotor.glb [tmp/windmill_rotor.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from mathutils import Matrix  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "blade": 0x8A4A2A,  # PAL.rust.top, C1's rust-pink blades
    "ring": 0x5E3420,  # PAL.rust.side
    "hub": 0x8A8A84,  # PAL.metalLight
}
SEED = 63

RADIUS = 2.4
INNER = 0.7  # where the blades start
BLADES = 16
PITCH = 0.45  # radians each blade is twisted about its own radius


def hoop(kit: Kit, name: str, radius: float) -> None:
    """A ring of short flat bars in the YZ plane, slightly in front of the blades."""
    for i in range(BLADES):
        a = 2 * math.pi * (i + 0.5) / BLADES
        chord = 2 * radius * math.sin(math.pi / BLADES) + 0.04
        kit.box(f"{name}{i}", (0.06, 0.07, chord), (0.08, radius * math.cos(a), radius * math.sin(a)), "ring", rot=(a, 0, 0))


def build(kit: Kit) -> None:
    kit.cylinder("hub", 0.3, 0.4, (0.0, 0.0, 0.0), "hub", rot=(0, math.pi / 2, 0), vertices=8)
    hoop(kit, "ring_in", INNER + 0.1)
    hoop(kit, "ring_out", RADIUS - 0.3)
    length = RADIUS - INNER
    mid = (INNER + RADIUS) / 2
    for i in range(BLADES):
        a = 2 * math.pi * i / BLADES
        # Each blade lies along its radius, twisted by PITCH about that radius: twist about Z, then turn about X.
        turn = (Matrix.Rotation(a - math.pi / 2, 4, "X") @ Matrix.Rotation(PITCH, 4, "Z")).to_euler()
        kit.box(f"blade{i}", (0.04, 0.42, length), (0.0, mid * math.cos(a), mid * math.sin(a)), "blade", rot=tuple(turn), dent_by=0.01)
        kit.box(f"spoke{i}", (0.05, 0.05, INNER), (0.05, INNER / 2 * math.cos(a), INNER / 2 * math.sin(a)), "ring", rot=(a - math.pi / 2, 0, 0))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("windmill_rotor", args, view_size=6.0)


if __name__ == "__main__":
    main()
