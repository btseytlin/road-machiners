"""The rock rise of Nose (C5): a faceted orange-brown mountain the colony ship came down on, with the town's ring
built up to its flanks. Its front edge is a timber-and-scrap retaining terrace 6 m high along the yard, with a flat
platform strip behind it, and from the platform a rubble slope climbs to the cradle under the ship's belly. Behind the
ship it climbs to a crest just past the ring, and falls away outside it to a low face over raised ground. Past the
nose's tip the rubble falls to the sand, so the yard runs open to the WNW gate.

Stands in the site frame of nose_rock_kit.py: the origin is the site center at ground level, +X along the ship toward
its nose, +Y toward the south gate. Its footprint is the far side from the gate, past 4 m back, clear of the WNW gate's
ground, a 34 m disc at (92, -80). East of x = -105 the front edge bends toward the gate. Off the mountain's arc it stays
inside 120 m of the center. Two sockets give the ship's pose, both on the hull axis: the nose joint at (-45, -40, 38),
17 m under the nose belly's lowest point, and a rear point 105 m along, 9.5 degrees lower.
Run: blender --background --python tools/blender/nose_rise.py -- public/models/nose_rise.glb [tmp/nose_rise.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from nose_rock_kit import CLIP, COLORS, FRONT_V, bent, heightfield, mid_arc, on_arc, past_ring  # noqa: E402

SEED = 61
TERRACE_Z = 6.0  # the platform strip's height, and the retaining terrace's
PLATFORM_END = 19.0  # the platform strip runs back to here, in meters from the center
AXIS_V = 40.0  # the ship axis, meters back
HULL_R = 18.0
# The nose joint. The ship lies east enough that its 56 m nose ends short of the line from the WNW gate to the game
# camera, so the gate and its pad stay in view.
JOINT = (-45.0, -AXIS_V, 38.0)
TIP_X = JOINT[0] + 56.0
FALL = 30.0  # past the tip the rubble falls to the sand over this many meters, leaving the yard open to the WNW gate
PITCH = math.radians(9.5)
REAR_AT = 105.0
REAR = (JOINT[0] - REAR_AT, -AXIS_V, JOINT[2] - REAR_AT * math.tan(PITCH))
PLATFORM = (-44.0, 8.0)  # the stretch of front edge that carries the platform, meters along x
CRADLE_HALF = 8.0  # the flat of the cradle under the belly, to either side of the axis
# The mountain on its arc: it starts MOUNT_START m from the center, stands at RING_SHARE of PEAK at the curtain, crests
# at CREST of the way out past the ring, and its foot is a FOOT_Z face over the 5 m of ground the bake raises around it
# (NOSE_APRON in src/data/fortress.ts). The 16 m ship-metal wall ends against it.
PEAK = 56.0  # mid-arc, behind the ship
END_SHARE = 0.55  # share of PEAK at the arc's ends, where the walls meet the rock
MOUNT_START = 80.0
RING_SHARE = 0.55
CREST = 0.3
FOOT_Z = 8.0


def front(x: float) -> float:
    return FRONT_V - bent(x)


def axis_z(x: float) -> float:
    return JOINT[2] + (x - JOINT[0]) * math.tan(PITCH)


def platform(x: float) -> float:
    """1 along the stretch of front edge that carries the timber platform, falling to 0 either side over 14 m: past
    it the front edge is a rubble slope."""
    return min(1.0, max(0.0, min(x - PLATFORM[0], PLATFORM[1] - x) / 14.0 + 1.0))


def mountain(x: float, v: float) -> float:
    """The mountain's surface on its arc, 0 off it."""
    if not on_arc(x, -v):
        return 0.0
    peak = PEAK * (END_SHARE + (1 - END_SHARE) * mid_arc(x, -v))
    d = math.hypot(x, v)
    if d <= CLIP:
        return peak * RING_SHARE * min(1.0, max(0.0, (d - MOUNT_START) / (CLIP - MOUNT_START))) ** 1.2
    t = past_ring(x, -v)
    if t < CREST:
        return peak * (RING_SHARE + (1 - RING_SHARE) * math.sin(t / CREST * math.pi / 2))
    return FOOT_Z + (peak - FOOT_Z) * math.cos((t - CREST) / (1 - CREST) * math.pi / 2) ** 0.8


def height(x: float, v: float) -> float:
    belly = min(axis_z(x) - HULL_R, 22.0)
    # The cradle runs under the hull and stops past the nose's tip, so no ridge stands between the WNW gate and the camera.
    past_tip = max(0.0, x - TIP_X)
    cradle = belly + 1.5 - max(0.0, abs(v - AXIS_V) - CRADLE_HALF) - past_tip
    back = TERRACE_Z + 20.0 * min(1.0, max(0.0, (v - 60.0) / 56.0)) ** 1.3
    t = platform(x)
    # Along the platform the front is a flat strip at the terrace height, elsewhere a slope from the sand.
    slope = min(1.0, max(0.0, (v - FRONT_V) / 20.0)) * 14.0
    front_strip = TERRACE_Z * t + slope * (1.0 - t) if v < PLATFORM_END else 0.0
    # Past the nose's tip the rubble falls to the sand over FALL meters, and only the mountain goes on.
    fall = min(1.0, max(0.0, 1.0 - past_tip / FALL))
    return max(max(front_strip, cradle, back) * fall, mountain(x, v), 0.3)


def rubble_or_mountain(x: float, v: float) -> bool:
    """Whether (x, v) carries rock: under or by the ship, or on the mountain."""
    return x < TIP_X + FALL or mountain(x, v) > 0.0


def jitter(x: float, v: float) -> float:
    if math.hypot(x, v) > CLIP:
        # Calmer toward the foot, so no facet dips under the raised ground around it.
        return 1.0 + 2.5 * (1.0 - past_ring(x, -v))
    return 0.3 * platform(x) + 1.6 * (1 - platform(x)) if v < PLATFORM_END else 1.6


def build(kit: Kit) -> None:
    heightfield(kit, "rise", height, front, rubble_or_mountain, jitter, terrace=lambda x, v: platform(x) > 0.5)
    kit.socket("ship_front", JOINT)
    kit.socket("ship_rear", REAR)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("nose_rise", args, view_size=440)


if __name__ == "__main__":
    main()
