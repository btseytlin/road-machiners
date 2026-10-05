"""The rock rise of Nose (C5): a faceted orange-brown mass that fills the far side of the ring and carries the colony
ship. Its front edge is a timber-and-scrap retaining terrace 6 m high along the yard, with a flat platform strip
behind it, and from the platform a rubble slope climbs to the cradle under the ship's belly. It also banks up toward
the back of the ring.

Stands in the site frame of nose_rock_kit.py: the origin is the site center at ground level, +X along the ship toward
its nose, +Y toward the south gate. Its footprint is the far side from the gate, past FRONT(x) meters back, inside 116 m
of the center and clear of the WNW gate's ground. Two sockets give the ship's pose, both on the hull axis: the nose
joint at (35, -40, 35), 17 m under the nose belly's lowest point, and a rear point 105 m along, 8 degrees lower.
Run: blender --background --python tools/blender/nose_rise.py -- public/models/nose_rise.glb [tmp/nose_rise.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from nose_rock_kit import COLORS, heightfield  # noqa: E402

SEED = 61
TERRACE_Z = 6.0  # the platform strip's height, and the retaining terrace's
PLATFORM_END = 19.0  # the platform strip runs back to here, in meters from the center
AXIS_V = 40.0  # the ship axis, meters back
HULL_R = 18.0
JOINT = (35.0, -AXIS_V, 35.0)
PITCH = math.radians(8.0)
REAR_AT = 105.0
REAR = (JOINT[0] - REAR_AT, -AXIS_V, JOINT[2] - REAR_AT * math.tan(PITCH))
CRADLE_HALF = 8.0  # the flat of the cradle under the belly, to either side of the axis


def front(x: float) -> float:
    return 5.0 + 2.5 * math.sin(x / 17.0)


def axis_z(x: float) -> float:
    return JOINT[2] + (x - JOINT[0]) * math.tan(PITCH)


def height(x: float, v: float) -> float:
    belly = min(axis_z(x) - HULL_R, 19.0)
    cradle = belly + 1.5 - max(0.0, abs(v - AXIS_V) - CRADLE_HALF)
    back = TERRACE_Z + 20.0 * min(1.0, max(0.0, (v - 60.0) / 56.0)) ** 1.3
    return max(TERRACE_Z, cradle, back)


def jitter(x: float, v: float) -> float:
    return 0.3 if v < PLATFORM_END else 1.6


def build(kit: Kit) -> None:
    heightfield(kit, "rise", height, front, None, jitter, terrace=lambda x, v: v < PLATFORM_END)
    kit.socket("ship_front", JOINT)
    kit.socket("ship_rear", REAR)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("nose_rise", args, view_size=260)


if __name__ == "__main__":
    main()
