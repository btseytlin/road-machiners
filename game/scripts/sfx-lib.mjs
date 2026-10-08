// Shared sound import: every file, whatever its source, gets the same treatment before the game uses it.
// 1. Free music loses its quiet intro and outro and loops through a crossfade. A beat loop is stretched to its exact
//    bar length, so layers stay locked.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { beatLoopSeconds } from '../src/data/sounds.ts';

export const SFX_DIR = 'public/sfx';
const PEAK_DB = -1;
const MAX_LIMIT_DB = 6;
const SILENCE_DB = -60;
const KEEP_S = 0.02;
const FADE_IN_S = 0.005;
const FADE_OUT_S = 0.03;
const EQ = 'highpass=f=40,lowpass=f=14000';
const BANDS = { low: 'lowpass=f=250', high: 'highpass=f=4000' };
const MID = 'highpass=f=250,lowpass=f=4000';
const MAX_MATCH_DB = 6;
const METER_S = 0.4;
const OPUS_KBPS = 96;
const MUSIC_EDGE_DB = 15;
const MUSIC_XFADE_S = 2;
const SILENT_PEAK_DB = -40;

export function cueOf(sounds, id) {
  const cue = sounds[id];
  if (!cue) throw new Error(`No cue "${id}" in src/data/sounds.ts. Add it first.`);
  return cue;
}

export function nextName(id) {
  const taken = new Set(readdirSync(SFX_DIR));
  for (let n = 1; ; n++) {
    const name = `${id}-${n}.ogg`;
    if (!taken.has(name)) return name;
  }
}

export function importFile(source, id, cue, level) {
  const name = nextName(id);
  const out = `${SFX_DIR}/${name}`;
  if (existsSync(out)) throw new Error(`${out} exists`);
  const src = playable(source, name, cue);
  const base = [...shapeFilters(src, cue), channels(src, cue), EQ];
  const family = (cue.prompts?.length ?? 0) > 1;
  const shaped = [...base, ...(family ? [] : toneMatch(src, base.join(','), id))].join(',');
  const rawPeak = measure(src, 'anull').peak;
  if (rawPeak < SILENT_PEAK_DB) throw new Error(`${src} peaks at ${rawPeak} dB; it is near silence. Skip it.`);
  const { loudness, peak } = measure(src, shaped);
  const gain = Math.min(level - loudness, PEAK_DB + MAX_LIMIT_DB - peak);
  const limiter = `alimiter=limit=${dbToLinear(PEAK_DB)}:attack=1:release=50:level=false:latency=true`;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-af', `${shaped},volume=${gain.toFixed(2)}dB,${limiter}`, '-ar', '48000', '-c:a', 'libopus', '-b:a', `${OPUS_KBPS}k`, '-metadata', `comment=${source}`, out]);
  const short = level - loudness - gain > 0.05 ? `, ${(level - loudness - gain).toFixed(1)} dB under target` : '';
  console.log(`${source} -> ${out}  ${loudness.toFixed(1)} LUFS, gain ${gain.toFixed(1)} dB${short}`);
  return name;
}

function playable(source, name, cue) {
  const freeMusic = cue.bus === 'music' && cue.loop && !cue.beat;
  return freeMusic ? musicLoop(source, name) : source;
}

function shapeFilters(src, cue) {
  if (cue.beat) return fitBeat(src, beatLoopSeconds(cue.beat));
  if (cue.loop) return [];
  const trim = `silenceremove=start_periods=1:start_threshold=${SILENCE_DB}dB:start_silence=${KEEP_S}`;
  const edges = cue.setup === 'stinger' ? STINGER_EDGES : [FADE_IN_S, FADE_OUT_S];
  const cap = cue.setup === 'stinger' ? [`atrim=end=${STINGER_MAX_S}`, STINGER_TONE] : [];
  return [trim, 'areverse', trim, 'areverse', ...cap, 'areverse', `afade=t=in:d=${edges[1]}`, 'areverse', `afade=t=in:d=${edges[0]}`];
}

const STINGER_MAX_S = 1.5;
const STINGER_TONE = 'lowpass=f=5000,treble=g=-4:f=3000';
const STINGER_EDGES = [0.02, 0.6];

const MAX_FIT = 0.01;

function fitBeat(src, seconds) {
  const have = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', src], { encoding: 'utf8' }));
  const ratio = have / seconds;
  if (Math.abs(ratio - 1) > MAX_FIT) throw new Error(`${src} lasts ${have} s, too far from its ${seconds.toFixed(3)} s beat loop`);
  return [`atempo=${ratio.toFixed(6)}`, `apad=whole_dur=${seconds.toFixed(6)}`, `atrim=end=${seconds.toFixed(6)}`];
}

function channels(src, cue) {
  if (cue.bus !== 'ambient' && cue.bus !== 'music') return 'pan=mono|c0=0.5*c0+0.5*c1';
  const log = ffmpegLog(src, `${EQ},astats=measure_overall=none:measure_perchannel=RMS_level`);
  const [l, r] = [...log.matchAll(/RMS level dB: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  if (l === undefined || r === undefined) throw new Error(`${src} is not stereo`);
  const mid = (l + r) / 2;
  return `pan=stereo|c0=${dbToLinear(mid - l).toFixed(4)}*c0|c1=${dbToLinear(mid - r).toFixed(4)}*c1`;
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function toneMatch(src, shaped, id) {
  const ref = readdirSync(SFX_DIR).filter((f) => new RegExp(`^${id}-\\d+\\.ogg$`).test(f)).sort((a, b) => variantNumber(a) - variantNumber(b))[0];
  if (!ref) return [];
  const want = bandBalance(`${SFX_DIR}/${ref}`, 'anull');
  const have = bandBalance(src, shaped);
  const clamp = (db) => Math.max(-MAX_MATCH_DB, Math.min(MAX_MATCH_DB, db));
  const low = clamp(want.low - have.low);
  const high = clamp(want.high - have.high);
  console.log(`  tone toward ${ref}: low ${low.toFixed(1)} dB, high ${high.toFixed(1)} dB`);
  return [`bass=g=${low.toFixed(2)}:f=250`, `treble=g=${high.toFixed(2)}:f=4000`];
}

function variantNumber(file) {
  return Number(file.match(/-(\d+)\.ogg$/)[1]);
}

function bandBalance(src, shaped) {
  const rms = (band) => statValue(ffmpegLog(src, `${shaped},${band},astats=measure_perchannel=0:measure_overall=RMS_level`), 'RMS level dB');
  const mid = rms(MID);
  return { low: rms(BANDS.low) - mid, high: rms(BANDS.high) - mid };
}

function measure(src, shaped) {
  const log = ffmpegLog(src, `${shaped},apad=whole_dur=${METER_S},ebur128=peak=sample`);
  const momentary = [...log.matchAll(/ M: *(-?[\d.]+)/g)].map((m) => Number(m[1]));
  if (momentary.length === 0) throw new Error(`Could not meter ${src}`);
  return { loudness: Math.max(...momentary), peak: statValue(log.slice(log.lastIndexOf('Summary:')), 'Peak') };
}

function ffmpegLog(src, filters) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-af', filters, '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${src}: ${r.stderr.slice(-400)}`);
  return r.stderr;
}

function statValue(log, key) {
  const m = log.match(new RegExp(`${key}: *(-?[\\d.]+|-inf)`));
  if (!m || m[1] === '-inf') throw new Error(`Could not measure ${key}; the file may be silent`);
  return Number(m[1]);
}

function musicLoop(src, name) {
  const { start, end } = loudSpan(src);
  const len = end - start;
  const x = MUSIC_XFADE_S;
  if (len < 4 * x) throw new Error(`${src} has only ${len.toFixed(1)} s of music`);
  const out = `tmp/sfx-raw/${name.replace('.ogg', '')}.loop.wav`;
  const graph = [
    `[0]atrim=start=${start}:end=${end},asetpts=N/SR/TB,asplit=2[a][b]`,
    `[a]atrim=0:${x},afade=t=in:d=${x},adelay=${Math.round((len - 2 * x) * 1000)}:all=1[head]`,
    `[b]atrim=start=${x},asetpts=N/SR/TB,afade=t=out:st=${len - 2 * x}:d=${x}[body]`,
    `[body][head]amix=inputs=2:normalize=0:duration=first`,
  ].join(';');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-filter_complex', graph, out]);
  console.log(`${src}: music kept ${start.toFixed(1)}-${end.toFixed(1)} s, looped with a ${x} s crossfade`);
  return out;
}

function loudSpan(src) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg could not meter ${src}`);
  const points = [...r.stderr.matchAll(/t: *([\d.]+).*? S: *(-?[\d.]+|-inf)/g)].map((m) => ({ t: Number(m[1]), s: m[2] === '-inf' ? -Infinity : Number(m[2]) }));
  const loudest = Math.max(...points.map((p) => p.s));
  const loud = points.filter((p) => p.s >= loudest - MUSIC_EDGE_DB);
  if (loud.length === 0) throw new Error(`${src} has no loud part`);
  return { start: loud[0].t, end: loud[loud.length - 1].t };
}
