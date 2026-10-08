"""Leafless dead tree for the rows of a ruined orchard: a short trunk and a wide, gnarled crown.

Built at its in-game size, drawn at scale 1: 5.5 m tall with a crown about 6.5 m across, like the old orchard
concept's pruned trees. Its footprint radius below truck clearance is 1.2 m: the trunk forks at 1.7 m and every
limb climbs inside a 2.4 m square around the trunk until it is above 2.8 m (PHYSICS.truckClearance), so the crown
blocks neither driving nor nav. The crown spreads from 2.8 to 5.5 m and reaches 3.4 m from the trunk.
Run: blender --background --python tools/blender/dead_tree.py -- public/models/dead_tree.glb [tmp/dead_tree.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "trunk_dark": 0x5C4733,  # mix(PAL.trunk, PAL.rock.dark, 0.5), the weathered grey-brown wood of the concept's trees
    "trunk_dead": 0x877059,  # mix(PAL.trunk, PAL.rock.top, 0.6), sun-bleached dead wood
}
SEED = 41

# Short leaning trunk as a chain of joints, from the ground to the fork.
TRUNK = ((0, 0, 0), (0.1, 0.05, 0.9), (0.05, 0.1, 1.7))
FORK = Vector(TRUNK[-1])
# Main limbs from the fork, each (heading in degrees, then radius from the trunk and height in m of its knee, elbow
# and tip). A limb climbs steeply to its knee, inside 1.2 m of the trunk and above 2.8 m, then spreads to its elbow
# and turns up to its tip, so the crown is a wide vase.
LIMBS = (
    (10, (0.9, 3.0), (2.5, 3.6), (3.3, 4.6)),
    (82, (0.8, 3.2), (2.3, 4.0), (3.1, 5.5)),
    (155, (0.9, 3.0), (2.6, 3.5), (3.35, 4.4)),
    (220, (0.85, 3.1), (2.4, 3.8), (3.2, 5.0)),
    (290, (0.9, 3.0), (2.5, 3.6), (3.25, 4.7)),
)


def at(heading: float, radius: float, height: float) -> Vector:
    """A point `radius` m from the trunk axis toward `heading` degrees, at `height` m."""
    a = math.radians(heading)
    return Vector((radius * math.cos(a), radius * math.sin(a), height))


def build(kit: Kit) -> None:
    for i, (a, b) in enumerate(zip(TRUNK, TRUNK[1:])):
        strut(kit, f"trunk{i}", a, b, 0.44 - i * 0.08, "trunk_dark", sides=5, dent_by=0.03)
    kit.cylinder("roots", 0.5, 0.3, (0, 0, 0.15), "trunk_dark", vertices=5, dent_by=0.04)
    for i, (heading, knee, elbow, tip) in enumerate(LIMBS):
        k, e, t = at(heading, *knee), at(heading + 8, *elbow), at(heading - 6, *tip)
        strut(kit, f"limb{i}", tuple(FORK), tuple(k), 0.32, "trunk_dark", sides=5)
        strut(kit, f"limb{i}_arm", tuple(k), tuple(e), 0.24, "trunk_dark", sides=4)
        strut(kit, f"limb{i}_tip", tuple(e), tuple(t), 0.15, "trunk_dark", sides=4)
        # A crooked twig off each elbow, out to the side and up.
        side = e + (t - k).cross(Vector((0, 0, 1))).normalized() * 0.8 + Vector((0, 0, 0.6))
        strut(kit, f"limb{i}_twig", tuple(e), tuple(side), 0.1, "trunk_dead", sides=4)
    # A short leader up the middle of the crown, and a snapped stub low on the trunk.
    strut(kit, "leader", tuple(FORK), (0.2, -0.1, 3.6), 0.18, "trunk_dark", sides=4)
    strut(kit, "leader_tip", (0.2, -0.1, 3.6), (0.5, 0.3, 4.8), 0.1, "trunk_dead", sides=4)
    strut(kit, "stub", (0.05, 0.08, 1.0), (-0.5, 0.35, 1.3), 0.12, "trunk_dead", sides=4)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("dead_tree", args, view_size=16)


if __name__ == "__main__":
    main()
