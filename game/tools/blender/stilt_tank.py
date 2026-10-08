"""Bowl's water tank on a timber stilt stand (C1): a squat stave tank with hoops and a shallow cone roof.

Built at its in-game size: four posts on a 3.6 m square carry a deck at 4.0 m. The tank, radius 2.2 m, stands 4.2 m
tall on the deck, and its roof cone tops out at 9.0 m. A ladder climbs the +X side. Origin at the ground center.
Run: blender --background --python tools/blender/stilt_tank.py -- public/models/stilt_tank.glb [tmp/stilt_tank.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import ladder, strut, taper  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "stave": 0x86867E,  # FACTION_COLORS.convoys.side, C1's weathered grey tank
    "stave_dark": 0x5A5A58,  # PAL.metal, the joints between staves
    "hoop": 0x3A2418,  # PAL.rust.dark
    "roof": 0x8A8A84,  # PAL.metalLight
    "timber": 0x6A4A2A,  # PAL.trunk
    "plinth": 0x9A8A78,  # PAL.rock.top
}
SEED = 64

HALF = 1.8  # half the post square
DECK = 4.0
RADIUS = 2.2
TANK = 4.2
ROOF = 0.8
STAVES = 12
CORNERS = ((1, 1), (-1, 1), (-1, -1), (1, -1))


def build(kit: Kit) -> None:
    for i, (cx, cy) in enumerate(CORNERS):
        kit.box(f"footing{i}", (0.6, 0.6, 0.4), (cx * HALF, cy * HALF, 0.0), "plinth")
        kit.box(f"post{i}", (0.3, 0.3, DECK + 0.2), (cx * HALF, cy * HALF, DECK / 2 - 0.1), "timber", dent_by=0.01)
    for i, (c0, c1) in enumerate(zip(CORNERS, CORNERS[1:] + CORNERS[:1])):
        a = (c0[0] * HALF, c0[1] * HALF)
        b = (c1[0] * HALF, c1[1] * HALF)
        strut(kit, f"brace{i}a", (*a, 0.3), (*b, DECK - 0.4), 0.14, "timber")
        strut(kit, f"brace{i}b", (*b, 0.3), (*a, DECK - 0.4), 0.14, "timber")
        strut(kit, f"beam{i}", (*a, DECK - 0.2), (*b, DECK - 0.2), 0.22, "timber")
    kit.box("deck", (2 * HALF + 0.6, 2 * HALF + 0.6, 0.2), (0, 0, DECK), "timber")
    base = DECK + 0.1
    kit.cylinder("tank", RADIUS, TANK, (0, 0, base + TANK / 2), "stave", vertices=STAVES, dent_by=0.03)
    for i in range(STAVES):
        a = 2 * math.pi * i / STAVES
        kit.box(f"joint{i}", (0.06, 0.06, TANK), (RADIUS * math.cos(a), RADIUS * math.sin(a), base + TANK / 2), "stave_dark", rot=(0, 0, a))
    for i, z in enumerate((0.5, TANK / 2, TANK - 0.4)):
        kit.cylinder(f"hoop{i}", RADIUS + 0.05, 0.12, (0, 0, base + z), "hoop", vertices=STAVES)
    roof = kit.cylinder("roof", RADIUS + 0.2, ROOF, (0, 0, base + TANK + ROOF / 2), "roof", vertices=STAVES, dent_by=0.02)
    taper(roof, 0.12)
    ladder(kit, "ladder", (HALF + 0.35, 0.0, 0.0), base + TANK, 0.5, 0.0, "hoop")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("stilt_tank", args, view_size=12.0)


if __name__ == "__main__":
    main()
