// Reruns the turn of an error report headless, with the same pipeline as the turn worker, and prints what it throws.
// Usage: npm run error:replay -- <report.json.gz> [--from world|autosave]
// --from world, the default, loads the world in memory at the error. A failed turn's report also holds the physics drive it
// started from, so that turn reruns exactly. Without a drive, and always with --from autosave, the drive is built fresh from
// the world, and physics may differ from the player's run.
// Run it on the report's commit. A save from another commit may load through migrations but run other code.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildDrive, captureDrive, freeDrive, initPhysics } from '../src/phys/drive.ts';
import { computeTurn } from '../src/phys/turn.ts';
import { GAME_VERSION } from '../src/config.ts';
import { loadWorld, SAVE_KEY } from '../src/three/save.ts';
import { slotKey } from '../src/three/save-slots.ts';
import { TEST_MAP } from '../src/test/map.ts';

const file = process.argv[2];
if (!file || file.startsWith('--')) throw new Error('Usage: npm run error:replay -- <report.json.gz> [--from world|autosave]');
const fromIndex = process.argv.indexOf('--from');
const from = fromIndex >= 0 ? process.argv[fromIndex + 1] : 'world';
if (from !== 'world' && from !== 'autosave') throw new Error(`--from must be world or autosave, got "${from}"`);

const report = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
console.log(`Report: ${report.error.name}: ${report.error.message}`);
console.log(`Report build ${report.build} ${report.version}, this checkout ${GAME_VERSION}`);
if (report.version !== GAME_VERSION) console.warn('Warning: this checkout is not the report\'s version.');

const save = savedJson(report, from);
const storage = new Map([[slotKey(SAVE_KEY, 'auto'), save]]);
const world = loadWorld({ getItem: (key) => storage.get(key) ?? null }, 'auto', TEST_MAP);
if (!world) throw new Error('The save did not load');
console.log(`Loaded the ${from} at turn ${world.turn}`);

await initPhysics();
const drive = from === 'world' && report.drive ? decodeDrive(report.drive) : freshDrive(world);
const { terrain, ...state } = world;
const turn = computeTurn({ world: state, drive }, terrain);
console.log(`The turn ran with no error and reached turn ${turn.world.turn}.`);

function savedJson(report, from) {
  if (from === 'world') {
    if (!report.world) throw new Error('The report holds no world. It came from a boot error.');
    return JSON.stringify(report.world);
  }
  if (report.autosaveIsWorld) throw new Error('The autosave is the world in memory. Use --from world.');
  if (!report.autosave) throw new Error('The report holds no autosave.');
  return report.autosave;
}

function decodeDrive(drive) {
  console.log('Using the drive the failed turn started from.');
  return { ...drive, snapshot: new Uint8Array(Buffer.from(drive.snapshot, 'base64')) };
}

function freshDrive(world) {
  console.warn('Warning: the report holds no drive for this world. Physics starts fresh and may differ from the player\'s run.');
  const built = buildDrive(world);
  const saved = captureDrive(built);
  freeDrive(built);
  return saved;
}
