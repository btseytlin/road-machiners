// Renders every Graphviz diagram in this folder to an SVG next to it. Run with `npm run diagrams` from factory/.
// Each SVG carries the sha256 of its source, so src/diagrams.test.ts fails when a .dot file changed without a render.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

for (const name of readdirSync(dir).filter((file) => file.endsWith('.dot'))) {
  const source = readFileSync(join(dir, name), 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  const svg = execFileSync('dot', ['-Tsvg'], { input: source, encoding: 'utf8' });
  const [declaration, ...rest] = svg.split('\n');
  writeFileSync(join(dir, name.replace(/\.dot$/, '.svg')), [declaration, `<!-- source-sha256: ${hash} -->`, ...rest].join('\n'));
  console.log(`rendered ${name}`);
}
