"""Dustwell's fortress pieces in the compound style (C2): rust corrugated walls between concrete pilasters, pale
concrete corner blocks with a lamp post and rubble at their feet, and shut rust doors in a concrete frame.

Each fort_compound_<piece>.py script calls run(piece). Geometry helpers come from fort_kit.py.

Sizes, with one tile = 4 m:
- wall: one straight section 8.0 m along X, centered on the origin, 12 m tall and 2.8 m deep, the same on both long
  faces. Pilasters stand at X = -2 and +2, so walls laid end to end keep one every 4 m. The game stretches it along
  X only.
- tower: a 6 m footprint centered on the origin. A 5.2 m concrete block 13 m tall (C2's blocks are about 0.6x as wide as tall), a lamp post on top whose lamp uses
  the glow material, and a rubble skirt that stays inside the 6 m footprint.
- gate: 8 m wide along Y, 4 m deep along X and 12 m tall. Its outer face is the plane X = 0 and it faces +X, so the
  origin is the center of the outer face at ground level and the body runs to X = -4. Shut rust doors stand in a
  concrete frame. Nothing reaches past X = 0 (no flare).

Every piece has a skirt to 1.2 m below its ground point, so it never floats on uneven ground.
Faces are kept just inside 0.5 m collision cells, so face detail does not widen the collider (scripts/shape-lib.mjs).
"""

from __future__ import annotations

import math
import sys
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fort_kit import SKIRT, extrude, rect  # noqa: E402
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

WALL_LENGTH = 8.0
WALL_HALF_DEPTH = 1.3
WALL_HEIGHT = 12.0
RIB = 0.36  # corrugation pitch
TOWER_HALF = 2.6
TOWER_HEIGHT = 13.0
GATE_WIDTH = 8.0
GATE_DEPTH = 4.0
GATE_HEIGHT = 12.0
DOOR_TOP = 6.0  # C2's opening is about half the wall height

# Colors from src/render/palette.ts. C2 has pale weathered concrete, rust corrugated sheet and dark broken rock.
COLORS = {
    "concrete": 0xB8B8B0,  # FACTION_COLORS.convoys.top
    "stain": 0x9A8A78,  # PAL.rock.top, weathering on the concrete
    "crack": 0x6E6254,  # PAL.rock.side
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark, the core between sheets
    "rubble": 0x4E453C,  # PAL.rock.dark
    "metal": 0x5A5A58,  # PAL.metal
    "glow": 0xFFF2C8,  # PAL.lamp.on
}

SEEDS = {"wall": 501, "tower": 502, "gate": 503}


def solid(kit: Kit, name: str, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float, mat: str) -> None:
    """An axis-aligned box from its bounds."""
    extrude(kit, name, rect(x0, x1, y0, y1), rect(x0, x1, y0, y1), z0, z1, mat)


def corrugate(kit: Kit, name: str, x0: float, x1: float, y: float, sign: int, z0: float, z1: float, along_y: bool = False) -> None:
    """Rust corrugated sheet on a face at y, facing sign: vertical ribs from x0 to x1, a few sheets in another shade,
    and a ragged top edge. along_y swaps the axes, for a face at X = y running along Y."""
    count = int((x1 - x0) / RIB)
    pitch = (x1 - x0) / count
    sheet = kit.rng.choice(("rust", "rust_side"))
    for i in range(count):
        if i % 3 == 0:
            sheet = kit.rng.choice(("rust", "rust", "rust_side"))
        top = z1 - kit.rng.uniform(0.0, 0.5)
        x = x0 + (i + 0.5) * pitch
        mat = sheet if i % 2 else "rust_side"
        out = 0.07 if i % 2 else 0.03
        a, b = sorted((y, y + sign * out))
        if along_y:
            solid(kit, f"{name}_rib{i}", a, b, x - pitch / 2, x + pitch / 2, z0, top, mat)
        else:
            solid(kit, f"{name}_rib{i}", x - pitch / 2, x + pitch / 2, a, b, z0, top, mat)


def wall(kit: Kit) -> None:
    """One 8 m wall section: a rust core under corrugated sheets, two concrete pilasters and a concrete footing."""
    h, d = WALL_LENGTH / 2, WALL_HALF_DEPTH
    solid(kit, "wall_core", -h, h, -d, d, -SKIRT, WALL_HEIGHT - 0.6, "rust_dark")
    for sign in (-1, 1):
        corrugate(kit, f"wall_face{sign}", -h, h, sign * d, sign, 0.8, WALL_HEIGHT - 0.3)
        solid(kit, f"wall_footing{sign}", -h, h, *sorted((sign * d, sign * (d + 0.12))), -SKIRT, 0.8, "stain")
    for k, x in enumerate((-2.0, 2.0)):
        solid(kit, f"wall_pilaster{k}", x - 0.35, x + 0.35, -d - 0.16, d + 0.16, -SKIRT, WALL_HEIGHT, "stain")
        for sign in (-1, 1):
            # Weathering streaks run down from the pilaster top.
            solid(kit, f"wall_streak{k}{sign}", x - 0.2, x + 0.05, *sorted((sign * (d + 0.16), sign * (d + 0.18))), WALL_HEIGHT - 4.5, WALL_HEIGHT - 0.2, "crack")
        solid(kit, f"wall_cap{k}", x - 0.4, x + 0.4, -d - 0.18, d + 0.18, WALL_HEIGHT - 0.3, WALL_HEIGHT, "concrete")


def _rubble(kit: Kit, name: str, at: tuple[float, float], spread: float, count: int, reach: float) -> None:
    """A heap of broken concrete and rock chunks around a point, kept inside |x|, |y| <= reach."""
    for i in range(count):
        s = kit.rng.uniform(0.6, 1.5)
        x = max(-reach + s * 0.9, min(reach - s * 0.9, at[0] + kit.rng.uniform(-spread, spread)))
        y = max(-reach + s * 0.9, min(reach - s * 0.9, at[1] + kit.rng.uniform(-spread, spread)))
        z = kit.rng.uniform(0.0, 1.0 if i % 3 else 2.6)
        kit.box(f"{name}{i}", (s, s * kit.rng.uniform(0.7, 1.1), s * 0.8), (x, y, z), kit.rng.choice(("rubble", "crack", "stain")),
                rot=(kit.rng.uniform(-0.4, 0.4), kit.rng.uniform(-0.4, 0.4), kit.rng.uniform(0, math.pi)), dent_by=0.08)


def tower(kit: Kit) -> None:
    """A pale concrete corner block with weathering, a lamp post on top and rubble at its feet."""
    half = TOWER_HALF
    solid(kit, "tower_core", -half, half, -half, half, -SKIRT, TOWER_HEIGHT - 0.4, "concrete")
    solid(kit, "tower_cap", -half - 0.08, half + 0.08, -half - 0.08, half + 0.08, TOWER_HEIGHT - 0.4, TOWER_HEIGHT, "stain")
    # Weathering: streaks and chipped patches on each face.
    for face, (ax, sign) in enumerate((("x", 1), ("y", 1), ("x", -1), ("y", -1))):
        n = sign * (half + 0.02)
        for k in range(4):
            u = kit.rng.uniform(-half + 0.5, half - 0.5)
            z1 = TOWER_HEIGHT - kit.rng.uniform(0.4, 2.0)
            z0 = z1 - kit.rng.uniform(2.0, 6.0)
            w = kit.rng.uniform(0.2, 0.7)
            mat = "crack" if k == 0 else "stain"
            if ax == "x":
                solid(kit, f"tower_streak{face}_{k}", n - 0.03, n + 0.03, u - w / 2, u + w / 2, z0, z1, mat)
            else:
                solid(kit, f"tower_streak{face}_{k}", u - w / 2, u + w / 2, n - 0.03, n + 0.03, z0, z1, mat)
    # Rubble heaps at the foot, mostly at the outer corner, as in C2.
    _rubble(kit, "tower_rubble_a", (2.3, 2.3), 1.0, 14, 2.95)
    _rubble(kit, "tower_rubble_b", (2.4, -1.2), 0.8, 7, 2.95)
    _rubble(kit, "tower_rubble_c", (-1.2, 2.4), 0.8, 7, 2.95)
    _rubble(kit, "tower_rubble_d", (-2.3, -2.3), 0.7, 5, 2.95)
    # A lamp post on the top.
    strut(kit, "tower_post", (1.4, 1.4, TOWER_HEIGHT), (1.4, 1.4, TOWER_HEIGHT + 2.4), 0.2, "metal", sides=6)
    solid(kit, "tower_lamp_arm", 0.8, 1.5, 1.35, 1.45, TOWER_HEIGHT + 2.2, TOWER_HEIGHT + 2.3, "metal")
    kit.box("tower_lamp", (0.4, 0.4, 0.35), (0.85, 1.4, TOWER_HEIGHT + 2.0), "glow")
    solid(kit, "tower_vent", -1.4, -0.6, -1.4, -0.6, TOWER_HEIGHT, TOWER_HEIGHT + 0.7, "metal")


def gate(kit: Kit) -> None:
    """Shut rust corrugated doors in a concrete frame: two posts and a deep lintel."""
    hw = GATE_WIDTH / 2
    post = 1.0
    inner = hw - post
    for sign in (-1, 1):
        y0, y1 = sorted((sign * inner, sign * (hw - 0.05)))
        solid(kit, f"gate_post{sign}", -GATE_DEPTH + 0.05, -0.05, y0, y1, -SKIRT, GATE_HEIGHT, "concrete")
        solid(kit, f"gate_post{sign}_streak", -0.06, -0.02, y0 + 0.2, y0 + 0.5, GATE_HEIGHT - 5.0, GATE_HEIGHT - 0.3, "stain")
    # Over the doors the curtain goes on: a concrete beam and corrugated sheet up to the wall top, as in C2.
    solid(kit, "gate_beam", -GATE_DEPTH + 0.05, -0.05, -inner, inner, DOOR_TOP + 0.4, DOOR_TOP + 1.2, "concrete")
    solid(kit, "gate_over", -GATE_DEPTH + 0.6, -0.6, -inner, inner, DOOR_TOP + 1.2, GATE_HEIGHT - 0.3, "rust_dark")
    corrugate(kit, "gate_over_out", -inner, inner, -0.6, 1, DOOR_TOP + 1.2, GATE_HEIGHT - 0.3, along_y=True)
    solid(kit, "gate_cap", -GATE_DEPTH + 0.02, -0.02, -hw + 0.02, hw - 0.02, GATE_HEIGHT - 0.3, GATE_HEIGHT, "stain")
    # The doors: a steel frame, two corrugated leaves and a dark seam, set 0.5 m behind the frame face.
    front = -0.5
    solid(kit, "gate_door_core", front - 0.5, front - 0.1, -inner, inner, 0.0, DOOR_TOP + 0.4, "rust_dark")
    solid(kit, "gate_door_head", front - 0.1, front, -inner, inner, DOOR_TOP, DOOR_TOP + 0.4, "metal")
    for side, (a, b) in (("l", (-inner, -0.06)), ("r", (0.06, inner))):
        ys = [a + (b - a) * k / 10 for k in range(11)]
        for i in range(10):
            mat = "rust" if i % 2 else "rust_side"
            out = 0.08 if i % 2 else 0.03
            solid(kit, f"gate_door_{side}{i}", front - 0.1, front - 0.1 + out, ys[i], ys[i + 1], 0.0, DOOR_TOP, mat)
        for k, z in enumerate((1.0, DOOR_TOP / 2, DOOR_TOP - 1.0)):
            solid(kit, f"gate_door_{side}_bar{k}", front - 0.02, front + 0.1, a + 0.1, b - 0.1, z - 0.12, z + 0.12, "metal")
    solid(kit, "gate_door_seam", front - 0.1, front + 0.12, -0.06, 0.06, 0.0, DOOR_TOP, "rust_dark")


PIECES: dict[str, tuple[Callable[[Kit], None], float]] = {
    "wall": (wall, 14),
    "tower": (tower, 30),
    "gate": (gate, 22),
}


def run(piece: str) -> None:
    """Builds fort_compound_<piece> and exports it with an optional preview, from the script's command line."""
    if piece not in PIECES:
        raise KeyError(f"unknown compound piece {piece!r}. Known: {sorted(PIECES)}")
    args = parse_args()
    kit = Kit(COLORS, SEEDS[piece])
    build, view = PIECES[piece]
    build(kit)
    kit.export(f"fort_compound_{piece}", args, view_size=view)
