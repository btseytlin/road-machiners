"""Bowl's fortress pieces in the patchwork style (C1): a wall of salvage panels, concrete pillar towers with timber
watch huts, and an X-braced steel double gate between two pillars.

Each fort_patchwork_<piece>.py script calls run(piece). Geometry helpers come from fort_kit.py.

Sizes, with one tile = 4 m:
- wall: one straight section 8.0 m along X, centered on the origin, 12 m tall to its rail and 2.8 m deep. The game
  stretches it along X only, so the three 2.67 m panels on each face repeat within the module. +Y faces out of the
  site, since the layout lays walls counterclockwise: the timber walkway, its rail and its posts stand on the -Y
  (inner) side of the top.
- tower: a 6 m footprint centered on the origin. A concrete-block pillar 11.4 m tall carries a timber hut whose roof
  tops out at 16 m, with an antenna above it, glowing lamps at the hut corners and a ladder up the outer (+Y) face.
- gate: 12 m wide along Y, 5 m deep along X and 12 m tall. Its outer face is the plane X = 0 and it faces +X, so the
  origin is the center of the outer face at ground level and the body runs to X = -5. Two concrete pillars flank
  shut steel leaves with an X brace on each, under a timber walkway. Nothing reaches past X = 0 (no flare).

Every piece has a skirt to 1.2 m below its ground point, so it never floats on uneven ground.
Faces are kept just inside 0.5 m collision cells, so face detail does not widen the collider (scripts/shape-lib.mjs).
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fort_kit import SKIRT, extrude, rect  # noqa: E402
from kit import Kit, parse_args  # noqa: E402
from shapes import ladder, strut  # noqa: E402

WALL_LENGTH = 8.0
WALL_HALF_DEPTH = 1.3  # the core; panels stand 0.08 m proud of it, inside the 1.5 m cell line
WALL_HEIGHT = 12.0
DECK = 10.6  # the walkway floor
PANELS = 3  # per face and module, 2.67 m each (C1: a panel is about 0.45x the wall height; 3 keep colors varied)
TOWER_HALF = 2.8  # the pillar core; blocks stand to 2.86 m
PILLAR_TOP = 11.4
TOWER_ROOF = 16.0
GATE_WIDTH = 12.0
GATE_DEPTH = 5.0
GATE_HEIGHT = 12.0
GATE_PILLAR = 2.5  # each pillar's width along Y
GATE_LEAF_TOP = 10.2

# Colors from src/render/palette.ts. C1's panels are white, rust red, slate blue, ochre and grey.
COLORS = {
    "pale": 0xB8B8B0,  # FACTION_COLORS.convoys.top, white panels
    "rust": 0x8A3A2A,  # PAL.roof[2], rust red panels
    "slate": 0x5E7A8A,  # FACTION_COLORS.traders.top, slate blue panels
    "ochre": 0x9A741E,  # FACTION_COLORS.couriers.side, ochre panels
    "grey": 0x86867E,  # FACTION_COLORS.convoys.side, grey panels
    "seam": 0x3E4248,  # FACTION_COLORS.mercs.cabSide, the core between panels and blocks
    "strap": 0x5A5A58,  # PAL.metal, panel straps and steel
    "concrete": 0xB8B8B0,  # FACTION_COLORS.convoys.top, pale concrete blocks
    "block": 0x9A8A78,  # PAL.rock.top, the weathered blocks
    "timber": 0x6A4A2A,  # PAL.trunk
    "plank": 0x9A7A4A,  # PAL.crate
    "roof": 0x5E3420,  # PAL.rust.side, the hut roof
    "steel": 0x3E4248,  # FACTION_COLORS.mercs.cabSide, gate leaves
    "brace": 0x8A8A84,  # PAL.metalLight, the X braces on the leaves
    "glow": 0xFFF2C8,  # PAL.lamp.on, lit lamps and windows
}

SEEDS = {"wall": 401, "tower": 402, "gate": 403}


def solid(kit: Kit, name: str, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float, mat: str) -> None:
    """An axis-aligned box from its bounds."""
    extrude(kit, name, rect(x0, x1, y0, y1), rect(x0, x1, y0, y1), z0, z1, mat)


# --- Wall -----------------------------------------------------------------------------------------------------


def _panel_face(kit: Kit, name: str, sign: int, top: tuple[float, float], mats: tuple[str, str, str]) -> None:
    """Three vertical salvage panels on one long face in C1's colors, each with edge battens and two straps."""
    width = WALL_LENGTH / PANELS
    y = sign * (WALL_HALF_DEPTH + 0.04)
    for i, mat in enumerate(mats):
        x = -WALL_LENGTH / 2 + (i + 0.5) * width
        z1 = kit.rng.uniform(*top)
        kit.box(f"{name}_panel{i}", (width - 0.06, 0.08, z1 + 0.2), (x, y, (z1 - 0.2) / 2), mat, dent_by=0.02)
        for side in (-1, 1):
            kit.box(f"{name}_batten{i}_{side}", (0.14, 0.1, z1 - 0.3), (x + side * (width / 2 - 0.12), sign * (WALL_HALF_DEPTH + 0.07), z1 / 2), "strap")
        for k, z in enumerate((z1 * 0.33, z1 * 0.68)):
            kit.box(f"{name}_strap{i}_{k}", (width - 0.2, 0.1, 0.16), (x, sign * (WALL_HALF_DEPTH + 0.07), z + kit.rng.uniform(-0.3, 0.3)), "strap")


def _rail(kit: Kit, name: str, y: float, x0: float, x1: float, z0: float, z1: float, posts: list[float]) -> None:
    """A timber rail along X at y: posts from z0 to z1 with a top and a middle rail."""
    for k, x in enumerate(posts):
        solid(kit, f"{name}_post{k}", x - 0.09, x + 0.09, y - 0.09, y + 0.09, z0, z1, "timber")
    solid(kit, f"{name}_top", x0, x1, y - 0.07, y + 0.07, z1 - 0.14, z1, "timber")
    solid(kit, f"{name}_mid", x0, x1, y - 0.05, y + 0.05, (z0 + z1) / 2 - 0.05, (z0 + z1) / 2 + 0.05, "plank")


def wall(kit: Kit) -> None:
    """One 8 m wall section: a dark core, salvage panels on both faces, a timber walkway with a rail on the inner top."""
    h, d = WALL_LENGTH / 2, WALL_HALF_DEPTH
    solid(kit, "wall_core", -h, h, -d, d, -SKIRT, DECK, "seam")
    _panel_face(kit, "wall_out", 1, (11.0, 11.5), ("pale", "rust", "slate"))
    _panel_face(kit, "wall_in", -1, (DECK - 0.2, DECK + 0.1), ("ochre", "grey", "pale"))
    # The walkway: planks across the top behind the outer panels' parapet.
    for k in range(8):
        x = -h + (k + 0.5)
        solid(kit, f"wall_plank{k}", x - 0.47, x + 0.47, -d - 0.05, d - 0.05, DECK, DECK + 0.14, "plank")
    _rail(kit, "wall_rail_in", -d - 0.02, -h, h, DECK + 0.14, WALL_HEIGHT, [-3.0, -1.0, 1.0, 3.0])
    # Posts behind the outer parapet carry the outer rail just over it.
    _rail(kit, "wall_rail_out", d - 0.15, -h, h, DECK + 0.14, WALL_HEIGHT - 0.2, [-2.0, 2.0])
    # Timber braces under the walkway on the inner face, as in C1.
    for k, x in enumerate((-2.0, 2.0)):
        strut(kit, f"wall_brace{k}", (x - 0.9, -d - 0.12, DECK - 2.4), (x, -d - 0.12, DECK - 0.05), 0.16, "timber")
        strut(kit, f"wall_brace{k}b", (x + 0.9, -d - 0.12, DECK - 2.4), (x, -d - 0.12, DECK - 0.05), 0.16, "timber")


# --- Tower ----------------------------------------------------------------------------------------------------


def _blocks(kit: Kit, name: str, half: float, z0: float, z1: float) -> None:
    """Pale concrete blocks in courses on all four faces of a square pillar, a few of them weathered."""
    course = (z1 - z0) / 8
    rows = 8
    for face, (ax, sign) in enumerate((("x", 1), ("y", 1), ("x", -1), ("y", -1))):
        for r in range(rows):
            count = 3
            off = 0.5 if r % 2 else 0.0
            w = 2 * half / count
            for c in range(count + (1 if off else 0)):
                u0 = max(-half, -half + (c - off) * w)
                u1 = min(half, -half + (c + 1 - off) * w)
                if u1 - u0 < 0.3:
                    continue
                z = z0 + r * course
                mat = "block" if kit.rng.random() < 0.25 else "concrete"
                lo, hi = u0 + 0.04, u1 - 0.04
                n = sign * (half + 0.03)
                if ax == "x":
                    solid(kit, f"{name}_b{face}_{r}_{c}", n - 0.03, n + 0.03, lo, hi, z + 0.04, z + course - 0.04, mat)
                else:
                    solid(kit, f"{name}_b{face}_{r}_{c}", lo, hi, n - 0.03, n + 0.03, z + 0.04, z + course - 0.04, mat)


def _hut(kit: Kit, name: str, z0: float) -> None:
    """A timber watch hut on a pillar top: corner posts, plank walls with lit windows, a hip roof and corner lamps."""
    half = 2.0
    top = z0 + 3.0
    for px in (-1, 1):
        for py in (-1, 1):
            solid(kit, f"{name}_post{px}{py}", px * half - 0.12, px * half + 0.12, py * half - 0.12, py * half + 0.12, z0, top, "timber")
            kit.box(f"{name}_lamp{px}{py}", (0.32, 0.32, 0.4), (px * (half + 0.3), py * (half + 0.3), top - 0.5), "glow")
            solid(kit, f"{name}_bracket{px}{py}", min(px * half, px * (half + 0.3)) - 0.05, max(px * half, px * (half + 0.3)) + 0.05,
                  min(py * half, py * (half + 0.3)) - 0.05, max(py * half, py * (half + 0.3)) + 0.05, top - 0.3, top - 0.2, "timber")
    # Plank walls up to the sill, open window band, then a plank lintel.
    wall = half - 0.08
    solid(kit, f"{name}_walls", -wall, wall, -wall, wall, z0, z0 + 1.3, "plank")
    solid(kit, f"{name}_back", -wall + 0.1, wall - 0.1, -wall + 0.1, wall - 0.1, z0 + 1.3, top - 0.5, "timber")
    for k, (ax, sign) in enumerate((("x", 1), ("y", 1), ("x", -1), ("y", -1))):
        n = sign * (wall - 0.02)
        if ax == "x":
            solid(kit, f"{name}_window{k}", n - 0.06, n + 0.06, -0.7, 0.7, z0 + 1.45, top - 0.65, "glow")
        else:
            solid(kit, f"{name}_window{k}", -0.7, 0.7, n - 0.06, n + 0.06, z0 + 1.45, top - 0.65, "glow")
    solid(kit, f"{name}_lintel", -wall, wall, -wall, wall, top - 0.5, top, "plank")
    # Balcony rail around the pillar top.
    edge = TOWER_HALF + 0.05
    for k, (x0, x1, y0, y1) in enumerate(((-edge, edge, edge - 0.08, edge), (-edge, edge, -edge, -edge + 0.08), (edge - 0.08, edge, -edge, edge), (-edge, -edge + 0.08, -edge, edge))):
        solid(kit, f"{name}_balcony{k}", x0, x1, y0, y1, z0 + 0.9, z0 + 1.05, "timber")
    for px in (-1, 0, 1):
        for py in (-1, 0, 1):
            if px or py:
                solid(kit, f"{name}_baluster{px}{py}", px * edge - 0.06 * px - 0.05, px * edge - 0.06 * px + 0.05, py * edge - 0.06 * py - 0.05, py * edge - 0.06 * py + 0.05, z0, z0 + 1.0, "timber")
    # A low hip roof with deep eaves, topping out at 16 m.
    eave = 2.55
    extrude(kit, f"{name}_eaves", rect(-eave, eave, -eave, eave), rect(-eave, eave, -eave, eave), top, top + 0.15, "roof")
    extrude(kit, f"{name}_roof", rect(-eave, eave, -eave, eave), rect(-1.5, 1.5, -1.5, 1.5), top + 0.15, TOWER_ROOF, "roof")


def tower(kit: Kit) -> None:
    """A concrete-block pillar with a timber watch hut, an antenna and an outside ladder."""
    half = TOWER_HALF
    solid(kit, "tower_core", -half, half, -half, half, -SKIRT, PILLAR_TOP, "seam")
    _blocks(kit, "tower", half, 0.0, PILLAR_TOP - 0.4)
    solid(kit, "tower_cap", -half - 0.08, half + 0.08, -half - 0.08, half + 0.08, PILLAR_TOP - 0.4, PILLAR_TOP, "concrete")
    _hut(kit, "tower_hut", PILLAR_TOP)
    strut(kit, "tower_antenna", (0.0, 0.0, TOWER_ROOF - 0.3), (0.0, 0.0, TOWER_ROOF + 2.4), 0.1, "strap", sides=5)
    strut(kit, "tower_antenna_b", (-1.6, -1.6, TOWER_ROOF - 1.1), (-1.6, -1.6, TOWER_ROOF + 1.2), 0.08, "strap", sides=5)
    kit.box("tower_antenna_bar", (0.9, 0.06, 0.06), (0.0, 0.0, TOWER_ROOF + 1.8), "strap")
    ladder(kit, "tower_ladder", (1.4, half + 0.12, 0.0), PILLAR_TOP + 0.9, 0.6, 1.5708, "timber")


# --- Gate -----------------------------------------------------------------------------------------------------


def _leaf(kit: Kit, name: str, x: float, y0: float, y1: float, z1: float) -> None:
    """One steel leaf from y0 to y1 and the ground to z1, framed on its outer face at x."""
    solid(kit, f"{name}_leaf", x - 0.6, x, y0, y1, 0.0, z1, "steel")
    f = x + 0.0
    t = 0.24
    for k, (a0, a1, b0, b1) in enumerate(((y0, y1, 0.0, t), (y0, y1, z1 - t, z1), (y0, y0 + t, 0.0, z1), (y1 - t, y1, 0.0, z1), (y0, y1, z1 / 2 - t / 2, z1 / 2 + t / 2))):
        solid(kit, f"{name}_frame{k}", f - 0.02, f + 0.08, a0, a1, b0, b1, "brace")


def gate(kit: Kit) -> None:
    """Two concrete-block pillars flank shut steel leaves under one X brace under a steel lintel and a timber walkway."""
    hw = GATE_WIDTH / 2
    inner = hw - GATE_PILLAR
    for sign in (-1, 1):
        y0, y1 = sorted((sign * inner, sign * (hw - 0.08)))
        cy = (y0 + y1) / 2
        half = (y1 - y0) / 2
        # A pillar is a tower pillar cut to the gate depth: its blocks run on every face, centered on (cx, cy).
        cx = -GATE_DEPTH / 2
        hx = GATE_DEPTH / 2 - 0.08
        solid(kit, f"gate_pillar{sign}", cx - hx, cx + hx, y0, y1, -SKIRT, 11.0, "seam")
        _pillar_blocks(kit, f"gate_pillar{sign}", cx, cy, hx, half)
        solid(kit, f"gate_pillar{sign}_cap", cx - hx - 0.05, cx + hx + 0.05, y0 - 0.03, y1 + 0.03, 11.0, GATE_HEIGHT, "concrete")
    # Shut leaves, set 0.6 m behind the pillar fronts.
    front = -0.6
    _leaf(kit, "gate_l", front, -inner, -0.03, GATE_LEAF_TOP)
    _leaf(kit, "gate_r", front, 0.03, inner, GATE_LEAF_TOP)
    # One X brace across both leaves, as C1's gate shows.
    t = 0.3
    strut(kit, "gate_brace_a", (front + 0.06, -inner + t, t), (front + 0.06, inner - t, GATE_LEAF_TOP - t), 0.3, "brace")
    strut(kit, "gate_brace_b", (front + 0.06, inner - t, t), (front + 0.06, -inner + t, GATE_LEAF_TOP - t), 0.3, "brace")
    solid(kit, "gate_seam", front - 0.65, front - 0.1, -0.05, 0.05, 0.0, GATE_LEAF_TOP, "seam")
    # A steel lintel over the leaves and the timber walkway joining the pillar tops.
    solid(kit, "gate_lintel", front - 0.9, front, -inner, inner, GATE_LEAF_TOP, GATE_HEIGHT - 0.9, "steel")
    solid(kit, "gate_lintel_face", front - 0.05, front + 0.02, -inner, inner, GATE_LEAF_TOP + 0.15, GATE_HEIGHT - 1.05, "strap")
    solid(kit, "gate_walk", -GATE_DEPTH + 0.2, front, -inner, inner, GATE_HEIGHT - 0.9, GATE_HEIGHT - 0.7, "plank")
    for sign, y in (("o", front - 0.1), ("i", -GATE_DEPTH + 0.3)):
        for k, py in enumerate((-inner + 0.2, -inner / 3, inner / 3, inner - 0.2)):
            solid(kit, f"gate_walk_post{sign}{k}", y - 0.08, y + 0.08, py - 0.08, py + 0.08, GATE_HEIGHT - 0.7, GATE_HEIGHT, "timber")
        solid(kit, f"gate_walk_rail{sign}", y - 0.06, y + 0.06, -inner, inner, GATE_HEIGHT - 0.14, GATE_HEIGHT, "timber")


def _pillar_blocks(kit: Kit, name: str, cx: float, cy: float, hx: float, hy: float) -> None:
    """Concrete block courses on the four faces of a rectangular gate pillar."""
    course = 11.0 / 8
    for r in range(8):
        z0 = r * course + 0.04
        z1 = (r + 1) * course - 0.04
        off = 0.5 if r % 2 else 0.0
        for face, (n_axis, sign, half_u, half_n) in enumerate((("x", 1, hy, hx), ("x", -1, hy, hx), ("y", 1, hx, hy), ("y", -1, hx, hy))):
            count = max(1, round(2 * half_u / 1.9))
            w = 2 * half_u / count
            for c in range(count + (1 if off else 0)):
                u0 = max(-half_u, -half_u + (c - off) * w) + 0.04
                u1 = min(half_u, -half_u + (c + 1 - off) * w) - 0.04
                if u1 - u0 < 0.3:
                    continue
                mat = "block" if kit.rng.random() < 0.25 else "concrete"
                n = sign * (half_n + 0.03)
                if n_axis == "x":
                    solid(kit, f"{name}_b{face}_{r}_{c}", cx + n - 0.03, cx + n + 0.03, cy + u0, cy + u1, z0, z1, mat)
                else:
                    solid(kit, f"{name}_b{face}_{r}_{c}", cx + u0, cx + u1, cy + n - 0.03, cy + n + 0.03, z0, z1, mat)


PIECES: dict[str, tuple[Callable[[Kit], None], float]] = {
    "wall": (wall, 14),
    "tower": (tower, 36),
    "gate": (gate, 30),
}


def run(piece: str) -> None:
    """Builds fort_patchwork_<piece> and exports it with an optional preview, from the script's command line."""
    if piece not in PIECES:
        raise KeyError(f"unknown patchwork piece {piece!r}. Known: {sorted(PIECES)}")
    args = parse_args()
    kit = Kit(COLORS, SEEDS[piece])
    build, view = PIECES[piece]
    build(kit)
    kit.export(f"fort_patchwork_{piece}", args, view_size=view)
