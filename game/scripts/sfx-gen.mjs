// Generates new variants of one catalog cue with ElevenLabs, keeps the raw files in tmp/sfx-raw/,
// imports them. Never overwrites a file.
// Usage: npm run sfx:gen -- <cue> <count>
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { beatLoopSeconds, MIX, SOUND_STYLE, SOUNDS } from '../src/data/sounds.ts';
import { cueOf, importFile } from './sfx-lib.mjs';

const API = 'https://api.elevenlabs.io/v1';
const RAW_DIR = 'tmp/sfx-raw';
const SFX_CREDITS_PER_SECOND = 10; // ElevenLabs price for sound effects with a set duration; the API asked 12 credits for 1.2 s
const PROMPT_INFLUENCE = 0.7; // well above the API default of 0.3, so the shared recording setup is followed

// Agent containers get the key in their env and have no .env file.
if (existsSync('.env')) process.loadEnvFile('.env');
const key = process.env.ELEVENLABS_API_KEY;
const cap = Number(process.env.SFX_MAX_GENERATIONS);
if (!key) throw new Error('ELEVENLABS_API_KEY is missing from .env');
if (!Number.isInteger(cap) || cap <= 0) throw new Error(`SFX_MAX_GENERATIONS must be a positive integer, got "${process.env.SFX_MAX_GENERATIONS}"`);

const [id, countArg] = process.argv.slice(2).filter((a) => a !== '--');
const count = Number(countArg);
if (!id || !Number.isInteger(count) || count <= 0) throw new Error('Usage: npm run sfx:gen -- <cue> <count>');
if (count > cap) throw new Error(`${count} generations exceed SFX_MAX_GENERATIONS=${cap}`);
const cue = cueOf(SOUNDS, id);
// A beat loop is exactly its bars long, so it goes to the sound API, which keeps the requested length and loops seamlessly.
const seconds = cue.beat ? beatLoopSeconds(cue.beat) : cue.seconds;
if (!cue.prompts || !seconds) throw new Error(`Cue ${id} needs prompts and seconds or a beat to generate`);
const music = cue.bus === 'music' && !cue.setup;
if (!music && !cue.setup) throw new Error(`Cue ${id} needs a setup to generate`);

// Families take the next prompts in order; single-prompt cues repeat theirs.
const textFor = (i) => {
  const subject = cue.prompts[(cue.files.length + i) % cue.prompts.length];
  return music ? subject : `${SOUND_STYLE[cue.setup]} ${subject}`;
};
console.log(`${id}: ${count} x ${seconds.toFixed(2)}s ${music ? 'music' : `sound, about ${Math.round(count * seconds * SFX_CREDITS_PER_SECOND)} credits`}`);

mkdirSync(RAW_DIR, { recursive: true });
for (let i = 0; i < count; i++) {
  const text = textFor(i);
  console.log(`prompt: ${text}`);
  const audio = await generate(text);
  const raw = `${RAW_DIR}/${id}-${Date.now()}.mp3`;
  writeFileSync(raw, audio);
  importFile(raw, id, cue, MIX.level[cue.bus]);
}

async function generate(text) {
  const [path, body] = music
    ? ['/music?output_format=mp3_44100_192', { prompt: text, music_length_ms: seconds * 1000, force_instrumental: true }]
    : ['/sound-generation?output_format=mp3_44100_192', { text, duration_seconds: seconds, loop: cue.loop, prompt_influence: PROMPT_INFLUENCE, model_id: 'eleven_text_to_sound_v2' }];
  const res = await fetch(API + path, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ElevenLabs ${path} failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
