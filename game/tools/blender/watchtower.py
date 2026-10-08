"""Glass Flats watchtower: a timber lattice tower with a railed lookout platform.

Reference radius 2.4 m, half the diagonal of its 3.4 m square of feet, built at its real size and drawn at scale 1. Four
legs lean in from the feet to a 3.0 m square of legs under a 3.5 m deck 7.0 m up. Ring beams at the foot, at 3.7 m and
under the deck carry X braces on every face of both tiers. The legs rise 1.6 m over the deck as corner posts with
rails on three sides, and one lookout pole reaches 9.6 m. A ladder climbs the open +x face.
Sizes are measured from docs/concepts/glass-flats-game-style-issue-112.jpg (tmp/models/watchtower/asset-brief.md).
Run: blender --background --python tools/blender/watchtower.py -- public/models/watchtower.glb [tmp/watchtower.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402
from shapes import ladder, strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "timber": 0x6A4A2A,  # PAL.trunk
    "timber_dark": 0x3A2418,  # PAL.rust.dark
    "deck": 0x7A5A3A,  # PAL.roof[0]
}
SEED = 115

FOOT = 1.7  # m, half the square of the feet
TOP = 1.5  # m, half the square of the legs at the platform
DECK = 7.0  # m, platform height
TIERS = (0.4, 3.7, DECK)  # m, ring beam heights; X braces fill between them
LEG = 0.34  # m, leg section


def corner(x: int, y: int, z: float) -> Vec3:
    """The leg corner (x, y in -1 or 1) at height z, as the legs lean in from FOOT to TOP."""
    h = FOOT + (TOP - FOOT) * z / DECK
    return (x * h, y * h, z)


def build(kit: Kit) -> None:
    corners = ((1, 1), (1, -1), (-1, -1), (-1, 1))
    for i, (x, y) in enumerate(corners):
        strut(kit, f"leg{i}", corner(x, y, 0.0), corner(x, y, DECK + 1.6), LEG, "timber", dent_by=0.02)
    for t, z in enumerate(TIERS):
        for i in range(4):
            (ax, ay), (bx, by) = corners[i], corners[(i + 1) % 4]
            strut(kit, f"ring{t}_{i}", corner(ax, ay, z), corner(bx, by, z), 0.18, "timber_dark")
            if t > 0:
                lo = TIERS[t - 1]
                strut(kit, f"x{t}_{i}a", corner(ax, ay, lo), corner(bx, by, z), 0.17, "timber_dark")
                strut(kit, f"x{t}_{i}b", corner(bx, by, lo), corner(ax, ay, z), 0.17, "timber_dark")
    kit.box("deck", (2 * TOP + 0.5, 2 * TOP + 0.5, 0.2), (0, 0, DECK + 0.1), "deck", dent_by=0.03)
    # Rails on three sides, open over the ladder.
    for i in range(4):
        (ax, ay), (bx, by) = corners[i], corners[(i + 1) % 4]
        if i == 0:
            continue  # the +x side, where the ladder comes up
        strut(kit, f"rail{i}", corner(ax, ay, DECK + 1.0), corner(bx, by, DECK + 1.0), 0.12, "timber")
    strut(kit, "pole", (-TOP, TOP, DECK), (-TOP - 0.2, TOP + 0.2, 9.6), 0.16, "timber_dark")
    strut(kit, "pole_bar", (-TOP - 0.6, TOP - 0.4, 9.1), (-TOP + 0.3, TOP + 0.7, 9.1), 0.1, "timber_dark")
    ladder(kit, "ladder", (FOOT + 0.25, 0.0, 0.0), DECK + 0.2, 0.6, 0.0, "timber")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("watchtower", args, view_size=18.0)


if __name__ == "__main__":
    main()
