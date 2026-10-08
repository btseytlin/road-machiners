// Rebuilds every cue's files from their raw sources, oldest first, after an import change.
// Sources come from each file's comment tag. They are saved to a manifest first, so a crashed run resumes
// from the manifest instead of from half-rebuilt files.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { MIX, SOUNDS } from '../src/data/sounds.ts';
import { importFile, SFX_DIR } from './sfx-lib.mjs';

const MANIFEST = 'tmp/sfx-sources.json';

const sourceOf = (file) => {
  const tag = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream_tags=comment', '-of', 'default=nw=1:nk=1', `${SFX_DIR}/${file}`], { encoding: 'utf8' }).trim();
  if (!tag) throw new Error(`${file} has no source tag; import it again by hand`);
  return tag;
};

if (!existsSync(MANIFEST)) {
  const sources = Object.fromEntries(Object.entries(SOUNDS).map(([id, cue]) => [id, cue.files.map(sourceOf)]));
  writeFileSync(MANIFEST, JSON.stringify(sources, null, 1));
}
const sources = JSON.parse(readFileSync(MANIFEST, 'utf8'));
for (const [id, cue] of Object.entries(SOUNDS)) {
  cue.files.forEach((f) => unlinkSync(`${SFX_DIR}/${f}`));
  for (const src of sources[id]) importFile(src, id, cue, MIX.level[cue.bus]);
}
unlinkSync(MANIFEST);
console.log('all files rebuilt');
