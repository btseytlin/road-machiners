"""Rusty corrugated Quonset hut of the old army farm, big enough to hangar army trucks: a half-cylinder of sheet
metal on a low concrete footing, with end walls and a truck-wide door.

Built at its in-game size, 22 m long along X, 12 m wide and 6.5 m tall: the old orchard concept's huts are about
2.7 army trucks long. Its footprint radius is 12.9 m, the reach of the scrap by the door; the shell's corners reach
12.5 m. The door end faces +X, set back under the shell's lip.
Run: blender --background --python tools/blender/quonset.py -- public/models/quonset.glb [tmp/quonset.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import prism  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "sheet": 0xBDB59E,  # mix(PAL.metalLight, PAL.plan, 0.5), the concept's pale weathered galvanised sheet
    "rib": 0x5A5A58,  # PAL.metal
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_dark": 0x5E3420,  # PAL.rust.side
    "end": 0x6E6254,  # PAL.rock.side, plank and sheet end walls, and the footing
    "dark": 0x2A1A10,  # PAL.shadow
}
SEED = 71
LENGTH = 22.0  # m along X
RADIUS = 6.0  # m, half the width
FOOTING = 0.5  # m, the concrete footing the arch stands on, so the hut is 6.5 m tall
SIDES = 10  # facets over the half circle
RIB_GAP = 2.0  # m between corrugation ribs
INSET = 1.2  # m, how far the front end wall stands back under the shell's lip
DOOR_HALF = 2.4  # m, half the door's width: an army truck fits through
DOOR_H = 4.6  # m


def arch(radius: float, thick: float) -> list[tuple[float, float]]:
    """A closed half-ring profile in (across, up): the outer arc, then the inner arc back."""
    outer = [(radius * math.cos(math.pi * i / SIDES), radius * math.sin(math.pi * i / SIDES)) for i in range(SIDES + 1)]
    inner = [((radius - thick) * math.cos(math.pi * i / SIDES), (radius - thick) * math.sin(math.pi * i / SIDES)) for i in range(SIDES, -1, -1)]
    return outer + inner


def half_disc(radius: float) -> list[tuple[float, float]]:
    """A closed half-disc profile in (across, up)."""
    return [(radius * math.cos(math.pi * i / SIDES), radius * math.sin(math.pi * i / SIDES)) for i in range(SIDES + 1)]


def along_x(obj) -> None:
    """prism() extrudes along Blender Y; this turns a part so its extrusion runs along +X and its profile's across
    axis runs along -Y. It also lifts the part onto the footing."""
    obj.rotation_euler = (0, 0, math.radians(-90))
    obj.location.z = FOOTING


def build(kit: Kit) -> None:
    # The concrete footing under the shell's two long edges, and the dark floor between them.
    for side in (-1, 1):
        kit.box(f"footing{side:+d}", (LENGTH, 0.5, FOOTING), (0, side * (RADIUS - 0.2), FOOTING / 2), "end", dent_by=0.03)
    floor = LENGTH - INSET - 0.4
    kit.box("floor", (floor, 2 * RADIUS - 0.8, FOOTING - 0.05), (-LENGTH / 2 + 0.2 + floor / 2, 0, (FOOTING - 0.05) / 2), "dark")
    # The shell, and a dark inside seen through the door.
    along_x(prism(kit, "shell", arch(RADIUS, 0.12), -LENGTH / 2, LENGTH / 2, "sheet"))
    along_x(prism(kit, "inside", half_disc(RADIUS - 0.15), -LENGTH / 2 + 0.3, LENGTH / 2 - INSET - 0.4, "dark"))
    # Corrugation ribs standing proud of the shell.
    count = int(LENGTH / RIB_GAP)
    for i in range(count + 1):
        x = -LENGTH / 2 + 0.1 + i * (LENGTH - 0.2) / count
        along_x(prism(kit, f"rib{i}", arch(RADIUS + 0.08, 0.14), x - 0.12, x + 0.12, "rib"))
    # End walls: the back one closed, the front one set back from the shell's lip, with a door.
    along_x(prism(kit, "end_back", half_disc(RADIUS - 0.1), -LENGTH / 2 + 0.2, -LENGTH / 2 + 0.4, "end"))
    inset = LENGTH / 2 - INSET
    inner = RADIUS - 0.15
    for side in (-1, 1):
        # Two sheet panels either side of the door, cut flat at the arch, down to the ground in front of the footing.
        y0, y1 = sorted((side * DOOR_HALF, side * inner))
        panel = [(y0, -FOOTING), (y1, -FOOTING)]
        panel += [(y, math.sqrt(max(0.0, inner**2 - y * y))) for y in (y1, y0)]
        part = prism(kit, f"end_front{side:+d}", [(-y, z) for y, z in panel], inset - 0.2, inset, "end")
        along_x(part)
    # The sheet over the door, up to the arch.
    lintel, shoulder = DOOR_H - FOOTING, math.sqrt(inner**2 - DOOR_HALF**2)
    head = [(-DOOR_HALF, lintel), (DOOR_HALF, lintel), (DOOR_HALF, shoulder), (0.0, inner), (-DOOR_HALF, shoulder)]
    along_x(prism(kit, "door_head", head, inset - 0.2, inset, "end"))
    kit.box("door_step", (1.2, 2 * DOOR_HALF + 0.6, 0.16), (inset + 0.6, 0, 0.08), "rib", dent_by=0.02)
    # Rust patches over the shell, each a thin plate lying on one facet.
    for i in range(14):
        k = kit.rng.randrange(1, SIDES - 1)
        a = math.pi * (k + 0.5) / SIDES
        size = (kit.rng.uniform(1.6, 4.2), 0.05, kit.rng.uniform(1.0, 1.7))
        x = kit.rng.uniform(-LENGTH / 2 + size[0] / 2 + 0.3, LENGTH / 2 - size[0] / 2 - 0.3)
        r = RADIUS + 0.1
        kit.box(f"rust{i}", size, (x, r * math.cos(a), FOOTING + r * math.sin(a)), kit.rng.choice(("rust", "rust_dark")), rot=(a, 0, 0), dent_by=0.04)
    # A little scrap by the door.
    kit.box("scrap0", (1.0, 0.7, 0.06), (inset + 2.0, 3.4, 0.03), "rust_dark", rot=(0.1, 0, 0.6), dent_by=0.03)
    kit.box("scrap1", (0.8, 0.8, 0.6), (inset + 1.6, -4.0, 0.3), "rib", rot=(0, 0, 0.3), dent_by=0.04)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("quonset", args, view_size=32)


if __name__ == "__main__":
    main()
