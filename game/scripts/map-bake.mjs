// Bakes the map from MAPGEN.seed into public/<MAPGEN.file>, then writes the whole-map picture and one
// close-up per spot in MAPGEN.closeUps to tmp/map/.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MAPGEN } from '../src/data/terrain.ts';
import { decodeMap, encodeMap } from '../src/sim/terrain.ts';
import { bakeMap } from '../src/mapgen/bake.ts';
import { paintMap } from './map-preview.mjs';
import { encodePng } from './png.mjs';

const PICTURES = 'tmp/map';
const KIND_SIDE = 60;

const start = performance.now();
const draft = bakeMap(MAPGEN.seed);
const bytes = encodeMap(draft, MAPGEN.seed);
const { hash } = decodeMap(bytes);
const file = join('public', MAPGEN.file);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(`${file}.tmp`, bytes);
renameSync(`${file}.tmp`, file);
const kinds = Object.entries(Object.groupBy(draft.props, (p) => p.kind)).map(([kind, list]) => `${list.length} ${kind}`);
console.log(`${file}: ${bytes.length} bytes, hash ${hash}, props: ${kinds.join(', ')}, ${Math.round(performance.now() - start)} ms`);

mkdirSync(PICTURES, { recursive: true });
writePicture('overview', { x: 0, y: 0, w: draft.size, h: draft.size }, MAPGEN.overviewPxPerTile);
for (const spot of MAPGEN.closeUps) {
  const area = { x: spot.center.x - spot.side / 2, y: spot.center.y - spot.side / 2, w: spot.side, h: spot.side };
  writePicture(spot.name, area, MAPGEN.closeUpPxPerTile);
}
const firsts = [...new Map(draft.props.filter((p) => p.kind !== 'rock' && p.kind !== 'crag').map((p) => [p.kind, p])).values()].reverse();
for (const p of firsts) writePicture(`prop-${p.kind}`, { x: p.pos.x - KIND_SIDE / 2, y: p.pos.y - KIND_SIDE / 2, w: KIND_SIDE, h: KIND_SIDE }, MAPGEN.closeUpPxPerTile);
console.log(`${PICTURES}: ${MAPGEN.closeUps.length + firsts.length + 1} pictures, ${Math.round(performance.now() - start)} ms in all`);

function writePicture(name, area, pxPerTile) {
  const pic = paintMap(draft, area, pxPerTile);
  writeFileSync(join(PICTURES, `${name}.png`), encodePng(pic.width, pic.height, pic.rgba));
}
