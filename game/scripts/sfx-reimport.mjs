// Rebuilds cues' files from their raw sources, oldest first, after an import change. With no arguments it rebuilds
// every cue; `field` rebuilds the world one-shots; other arguments name cues.
// Sources come from each file's comment tag. They are saved to a manifest first, so a crashed run resumes
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { MIX, SOUNDS } from '../src/data/sounds.ts';
import { cueOf, importFile, isField, SFX_DIR } from './sfx-lib.mjs';

const MANIFEST = 'tmp/sfx-sources.json';

const sourceOf = (file) => {
  const tag = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream_tags=comment', '-of', 'default=nw=1:nk=1', `${SFX_DIR}/${file}`], { encoding: 'utf8' }).trim();
  if (!tag) throw new Error(`${file} has no source tag; import it again by hand`);
  if (!existsSync(tag)) throw new Error(`${file} comes from ${tag}, which is missing`);
  return tag;
};

const args = process.argv.slice(2).filter((a) => a !== '--');
const picked = () => {
  if (args.length === 0) return Object.keys(SOUNDS);
  if (args.length === 1 && args[0] === 'field') return Object.keys(SOUNDS).filter((id) => isField(SOUNDS[id]));
  args.forEach((id) => cueOf(SOUNDS, id));
  return args;
};

if (!existsSync(MANIFEST)) {
  const sources = Object.fromEntries(picked().map((id) => [id, SOUNDS[id].files.map(sourceOf)]));
  writeFileSync(MANIFEST, JSON.stringify(sources, null, 1));
}
const sources = JSON.parse(readFileSync(MANIFEST, 'utf8'));
for (const [id, srcs] of Object.entries(sources)) {
  const cue = SOUNDS[id];
  cue.files.forEach((f) => unlinkSync(`${SFX_DIR}/${f}`));
  for (const src of srcs) importFile(src, id, cue, MIX.level[cue.bus]);
}
unlinkSync(MANIFEST);
console.log(`rebuilt ${Object.keys(sources).join(', ')}`);
