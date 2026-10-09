// Box geometry for tests that check posed prop boxes against each other.

import { boxDistance, segmentCrossesBox, type PosedBox } from '../sim/mapgen';
import type { Vec } from '../sim/vec';

export function boxesOverlap(a: PosedBox, b: PosedBox): boolean {
  return boxEdges(a).some(([p, q]) => segmentCrossesBox(b, p, q)) || boxDistance(a, b.center) === 0 || boxDistance(b, a.center) === 0;
}

function boxEdges(box: PosedBox): [Vec, Vec][] {
  const corner = (sx: number, sy: number): Vec => ({
    x: box.center.x + box.axis.x * box.half.x * sx - box.axis.y * box.half.y * sy,
    y: box.center.y + box.axis.y * box.half.x * sx + box.axis.x * box.half.y * sy,
  });
  const c = [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)];
  return c.map((p, i) => [p, c[(i + 1) % 4]]);
}
