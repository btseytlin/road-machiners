// Shared sound import: every file, whatever its source, gets the same treatment before the game uses it.
// 1. Free music loses its quiet intro and outro and loops through a crossfade. A beat loop is stretched to its exact
//    bar length, so layers stay locked.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { beatLoopSeconds, MIX } from '../src/data/sounds.ts';

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
  const src = paletteFinish(playable(source, name, cue), name, cue);
  const shaped = toneChain(src, source, id, cue);
  const rawPeak = measure(src, 'anull').peak;
  if (rawPeak < SILENT_PEAK_DB) throw new Error(`${src} peaks at ${rawPeak} dB; it is near silence. Skip it.`);
  const { loudness, peak } = measure(src, shaped);
  const gain = Math.min(level - loudness, PEAK_DB + MAX_LIMIT_DB - peak);
  const limiter = `alimiter=limit=${dbToLinear(PEAK_DB)}:attack=1:release=50:level=false:latency=true`;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-af', `${shaped},volume=${gain.toFixed(2)}dB,${limiter}`, '-ar', '48000', '-c:a', 'libopus', '-b:a', `${OPUS_KBPS}k`, '-map_metadata', '-1', '-metadata', `comment=${source}`, out]);
  const short = level - loudness - gain > 0.05 ? `, ${(level - loudness - gain).toFixed(1)} dB under target` : '';
  console.log(`${source} -> ${out}  ${loudness.toFixed(1)} LUFS, gain ${gain.toFixed(1)} dB${short}`);
  return name;
}

function toneChain(src, source, id, cue) {
  const field = isField(cue);
  const base = [...shapeFilters(src, cue), channels(src, cue), EQ, ...(field ? [DISTANCE] : [])];
  const family = (cue.prompts?.length ?? 0) > 1;
  const matched = [...base, ...(family ? [] : toneMatch(src, base.join(','), id))];
  return [...matched, ...(field ? fieldTone(src, matched.join(','), source) : [])].join(',');
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

export function isField(cue) {
  return cue.bus === 'sfx' && cue.setup === 'field' && !cue.loop;
}

const DISTANCE = 'lowpass=f=8000:p=1';

const MAX_FIELD_CUT_DB = 12;
const MAX_FIELD_BOOST_DB = 6;
const FIT_PASSES = 3;
const MAX_SHELF_DB = 24;

function fieldTone(src, shaped, source) {
  const start = bandBalance(src, shaped);
  const goal = { low: start.low + backToSpread(start, 'low'), high: start.high + backToSpread(start, 'high') };
  if (goal.low === start.low && goal.high === start.high) return [];
  const gain = { low: 0, high: 0 };
  let have = start;
  for (let i = 0; i < FIT_PASSES; i++) {
    for (const band of ['low', 'high']) gain[band] = clampDb(gain[band] + goal[band] - have[band], MAX_SHELF_DB);
    have = bandBalance(src, [shaped, ...shelves(gain)].join(','));
  }
  console.log(`  ${source} toward the anchor: low ${(have.low - start.low).toFixed(1)} dB, high ${(have.high - start.high).toFixed(1)} dB`);
  return shelves(gain);
}

function backToSpread(balance, band) {
  const off = balance[band] - MIX.tone[band];
  const over = Math.sign(off) * Math.max(0, Math.abs(off) - MIX.tone.spread);
  return Math.max(-MAX_FIELD_CUT_DB, Math.min(MAX_FIELD_BOOST_DB, -over));
}

function clampDb(db, max) {
  return Math.max(-max, Math.min(max, db));
}

function shelves(gain) {
  return [`bass=g=${gain.low.toFixed(2)}:f=250`, `treble=g=${gain.high.toFixed(2)}:f=4000`];
}

function variantNumber(file) {
  return Number(file.match(/-(\d+)\.ogg$/)[1]);
}

export function bandBalance(src, shaped) {
  const rms = (band) => statValue(ffmpegLog(src, `${shaped},${band},astats=measure_perchannel=0:measure_overall=RMS_level`), 'RMS level dB');
  const mid = rms(MID);
  return { low: rms(BANDS.low) - mid, high: rms(BANDS.high) - mid };
}

export function measure(src, shaped) {
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

const OCTAVES = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
const PALETTE_TONE = [9.5, 9.9, 4.6, -0.2, -1.5, -1.7, -7.1, -13.6];
const TONE_SHARE = 0.6;
const WIDTH = 0.35;
const SIDE_GAIN = [0.5, 2.5];
const GLUE = 'acompressor=threshold=-26dB:ratio=2:attack=30:release=300:makeup=3';
const SOFT_TOP = 'lowpass=f=9000';
const ROOM = { wet: 0.18, seconds: 0.9, predelayMs: 15, cutoffHz: 6000 };
const ROOM_IR = 'tmp/sfx-raw/palette-room.wav';
const PALETTE_SR = 48000;

function paletteFinish(src, name, cue) {
  if (cue.bus !== 'music' || !cue.loop) return src;
  const seconds = durationOf(src);
  const stereo = `aresample=${PALETTE_SR},aformat=channel_layouts=stereo`;
  const chain = [toneToward(src, stereo), `stereotools=slev=${sideGain(src, stereo).toFixed(3)}`, GLUE, SOFT_TOP].join(',');
  const graph = [
    `[0]${stereo},asplit[a][b];[a][b]concat=n=2:v=0:a=1,${chain},asplit[dry][send]`,
    `[send][1]afir=dry=1:wet=1,volume=${ROOM.wet}[room];[dry]volume=${1 - ROOM.wet}[direct]`,
    `[direct][room]amix=inputs=2:normalize=0,atrim=start=${seconds.toFixed(6)}:end=${(2 * seconds).toFixed(6)},asetpts=N/SR/TB`,
  ].join(';');
  const out = `tmp/sfx-raw/${name.replace('.ogg', '')}.palette.wav`;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-i', roomIr(), '-filter_complex', graph, out]);
  return out;
}

export function octaveCurve(src, shaped = 'anull') {
  const levels = OCTAVES.map((f) => statValue(ffmpegLog(src, `${shaped},bandpass=f=${f}:width_type=o:w=1,astats=measure_perchannel=0:measure_overall=RMS_level`), 'RMS level dB'));
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
  return levels.map((l) => l - mean);
}

function toneToward(src, shaped) {
  const have = octaveCurve(src, shaped);
  const gains = have.map((h, i) => Math.max(-MAX_MATCH_DB, Math.min(MAX_MATCH_DB, (PALETTE_TONE[i] - h) * TONE_SHARE)));
  console.log(`  palette tone: ${gains.map((g) => g.toFixed(1)).join(' ')} dB`);
  return `firequalizer=zero_phase=on:gain_entry='${OCTAVES.map((f, i) => `entry(${f},${gains[i].toFixed(2)})`).join(';')}'`;
}

function sideGain(src, shaped) {
  const rms = (pan) => {
    const m = ffmpegLog(src, `${shaped},pan=mono|c0=0.5*c0${pan}0.5*c1,astats=measure_perchannel=0:measure_overall=RMS_level`).match(/RMS level dB: *(-?[\d.]+|-inf)/);
    if (!m) throw new Error(`Could not measure the width of ${src}`);
    return m[1] === '-inf' ? -Infinity : Number(m[1]);
  };
  const width = dbToLinear(rms('-') - rms('+'));
  return Math.max(SIDE_GAIN[0], Math.min(SIDE_GAIN[1], WIDTH / width));
}

function roomIr() {
  if (existsSync(ROOM_IR)) return ROOM_IR;
  const tail = (seed) => `anoisesrc=d=${ROOM.seconds}:c=white:seed=${seed}:r=${PALETTE_SR}:a=1`;
  const graph = `${tail(7)}[l];${tail(8)}[r];[l][r]join=inputs=2:channel_layout=stereo,aeval='val(ch)*exp(-6.9*t/${ROOM.seconds})':c=same,lowpass=f=${ROOM.cutoffHz},adelay=${ROOM.predelayMs}|${ROOM.predelayMs}`;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex', graph, ROOM_IR]);
  return ROOM_IR;
}

function durationOf(src) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', src], { encoding: 'utf8' }));
}
