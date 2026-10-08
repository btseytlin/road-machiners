// Lists every world one-shot's loudness and tone beside the sfx anchor, and flags the takes outside MIX.tone.
// Tone is the low band below 250 Hz and the high band above 4 kHz, each in dB against the 250 Hz to 4 kHz mids.
// Usage: npm run sfx:report
import { MIX, SOUNDS } from '../src/data/sounds.ts';
import { bandBalance, isField, measure, SFX_DIR } from './sfx-lib.mjs';

const SLACK_DB = 1; // an import shelf lands near the spread edge, not on it
const anchor = SOUNDS[MIX.anchors.sfx].files[0];
const row = (file) => {
  const { low, high } = bandBalance(`${SFX_DIR}/${file}`, 'anull');
  const loudness = measure(`${SFX_DIR}/${file}`, 'anull').loudness;
  const out = [['low', low], ['high', high]].filter(([band, db]) => Math.abs(db - MIX.tone[band]) > MIX.tone.spread + SLACK_DB).map(([band]) => band);
  const cells = [loudness, low, high].map((n) => n.toFixed(1).padStart(7)).join('');
  return `${file.padEnd(26)}${cells}  ${out.length ? `outside on ${out.join(' and ')}` : ''}`;
};

console.log(`target: low ${MIX.tone.low} dB, high ${MIX.tone.high} dB, spread ${MIX.tone.spread} dB; sfx level ${MIX.level.sfx} LUFS`);
console.log(`${'file'.padEnd(26)}   LUFS    low   high`);
console.log(`${row(anchor)}  anchor`);
for (const cue of Object.values(SOUNDS).filter(isField)) for (const f of cue.files) if (f !== anchor) console.log(row(f));
