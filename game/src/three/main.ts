
import { formatSupport, loadBank, recoverBank, reportFailures, type BankOptions, type LoadedBank } from '../audio/bank';
import { Mixer } from '../audio/mixer';
import { SoundPlayer } from '../audio/player';
import { CONFIG, ERROR_REPORT_URL, SFX_BYTES } from '../config';
import { BANK, MIX, SOUNDS } from '../data/sounds';
import { startKit } from '../data/start';
import { PHYSICS } from '../data/physics';
import { initPhysics } from '../phys/drive';
import { perfSnapshot, resetPerf } from '../perf';
import { fetchMap } from './map-file';
import type { World, WorldSetup } from '../sim/types';
import { newGame } from '../sim/new-game';
import { DebugConsole, Noclip } from '../ui/console';
import { BOOT_TEXT } from '../ui/boot-progress';
import { BootScreen } from '../ui/boot-screen';
import { uiRoot } from '../ui/dom';
import { loadLanguage, relocalize } from '../text/language';
import type { DevLocale } from '../text/msg';
import type { QuestLanguage } from '../data/quests';
import { setQuestLanguage } from '../sim/quests';
import { t } from '../text/msg';
import type { NewGameActions } from '../ui/new-game';
import { chooseSaveFate, chooseStart, saveErrorText, showCarryReport } from '../ui/save-screen';
import { mountPerfPanel } from '../ui/perf-panel';
import { SoundSettings } from '../ui/sound';
import { RadioPanel, RadioStation } from '../ui/radio';
import { bootStep, installCrashScreen, keepRunningOnErrors, onEveryError, noteError, onReport, reportError } from './crash';
import { ErrorReporter, gameContext } from './error-report';
import { Game } from './game';
import { clearGame, loadWorld, newMapFor, SAVE_KEY, SaveError, savedRunId, storedSave, writeSave } from './save';
import { openSaves } from './save-db';
import { RunLog } from './run-log';
import { allSlots, jumpToQuest, newestSlot, questJumpOf, requestBoot, takeBootRequest, type BootRequest, type QuestJump, type SlotId } from './save-slots';
import { GAME_GL, openWebGL } from './webgl';
import { rescueSave } from './save-rescue';
import { loadModels, type ModelFailure } from './render/models';
import { groundTexture } from './render/terrain';
import { defaultSetup, modeKit } from '../sim/settings';

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} element missing from the page`);
  return el;
}

type Booted = { world: World; runId: string; loadedFrom: SlotId | null; fresh: boolean };

async function bootWorld(): Promise<Booted> {
  if (questJump) return boot.track('world', () => jumpedRun(questJump), BOOT_TEXT.newGame);
  const request = takeBootRequest(window.sessionStorage, saveKey);
  if (typeof request === 'object' && request !== null) return bootRequested(request);
  const slot = request ?? (await startSlot());
  if (slot === null) return boot.track('world', () => newGameSaved(defaultSetup('roaming'), false), BOOT_TEXT.newGame);
  return boot.track('world', () => bootSlot(slot), BOOT_TEXT.loadSave);
}

async function startSlot(): Promise<SlotId | null> {
  const newest = newestSlot(slots, CONFIG.saveSlots);
  if (urlPlay()) return newest;
  return boot.aside(() => chooseStart(newest, newGameActions));
}

async function bootRequested(request: Exclude<BootRequest, SlotId>): Promise<Booted> {
  if ('new' in request) return boot.track('world', () => freshRun(request.new, request.intro), BOOT_TEXT.newGame);
  return boot.track('world', () => bootSlot(request.slot), BOOT_TEXT.nextWindow);
}

async function bootSlot(slot: SlotId): Promise<Booted> {
  try {
    const world = loadWorld(slots, slot, map);
    if (!world) return newGameSaved(defaultSetup('roaming'), true);
    const runId = savedRunId(storedSave(slots, slot));
    if (runId === null) throw new Error(`The save in ${slot} loaded but names no run`);
    return { world, runId, loadedFrom: slot, fresh: false };
  } catch (err) {
    if (!(err instanceof SaveError)) throw err;
    return rescuedOrNew(err, slot);
  }
}

function freshRun(setup: WorldSetup, intro: boolean): Booted {
  clearGame(slots, window.localStorage);
  return newGameSaved(setup, intro);
}

function jumpedRun(jump: QuestJump): Booted {
  const booted = newGameSaved(defaultSetup('roaming'), false);
  return { ...booted, world: jumpToQuest(booted.world, jump) };
}

function newGameSaved(setup: WorldSetup, intro: boolean): Booted {
  const world = newGameWorld(setup, intro);
  const runId = freshRunId();
  writeSave(slots, 'auto', world, runId, Date.now());
  return { world, runId, loadedFrom: null, fresh: true };
}

async function rescuedOrNew(error: SaveError, slot: SlotId): Promise<Booted> {
  const stored = storedSave(slots, slot);
  const canMigrate = typeof stored === 'object' && stored !== null && !Array.isArray(stored);
  await boot.aside(() => chooseSaveFate(saveErrorText(error), canMigrate, stored, newGameActions));
  const rescued = rescueSave(slots, slot, map, startKit(CONFIG.startKit), freshSeed, freshRunId, Date.now());
  if (!rescued) throw new Error('The save became unreadable while migrating');
  await boot.aside(() => showCarryReport(rescued.report));
  return { world: rescued.world, runId: rescued.runId, loadedFrom: null, fresh: false };
}

async function persistSaves(): Promise<void> {
  if (!navigator.storage) return console.warn('The page is not secure, so it cannot ask the browser to keep saves under disk pressure');
  if (!(await navigator.storage.persist())) console.warn('The browser did not grant persistent storage, so it may evict saves under disk pressure');
}

function newGameWorld(setup: WorldSetup, intro: boolean): World {
  const seed = CONFIG.seed ?? urlSeed() ?? freshSeed();
  return newGame(seed, modeKit(setup.mode, CONFIG.startKit), intro, newMapFor(setup, seed, map), setup);
}

function urlPlay(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('play');
}

function urlSeed(): number | null {
  const seed = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('seed') : null;
  if (seed === null) return null;
  if (!/^-?\d+$/.test(seed)) throw new Error(`?seed=${seed} is no whole number`);
  return Number(seed);
}

installCrashScreen();
const questJump = import.meta.env.DEV ? questJumpOf(window.location.search) : null;
const saveKey = questJump ? `${SAVE_KEY}-quest-view` : SAVE_KEY;
const language = loadLanguage(window.localStorage, window.location.search, import.meta.env.DEV, document.documentElement);
const questLanguageOf = (locale: DevLocale): QuestLanguage => (locale === 'pseudo' ? 'en' : locale);
setQuestLanguage(questLanguageOf(language.current()));
let relocalizeGame: (() => void) | null = null;
language.subscribe(() => {
  setQuestLanguage(questLanguageOf(language.current()));
  relocalize(uiRoot());
  relocalize(element('overlay'));
  relocalizeGame?.();
});
function whenVisible(run: () => void): void {
  if (document.visibilityState === 'visible') run();
  else {
    const onChange = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onChange);
      run();
    };
    document.addEventListener('visibilitychange', onChange);
  }
}
function reportStandIns(failures: ModelFailure[]): void {
  for (const { name, error } of failures) {
    noteError(new Error(`Model ${name} failed to load and stays a stand-in box: ${error instanceof Error ? error.message : String(error)}`));
  }
}
async function recoverSounds(loaded: LoadedBank): Promise<void> {
  const recovered = await recoverBank(mixer.ctx, loaded, SOUNDS, soundOptions);
  for (const failure of loaded.failures) console.warn(`Sound ${failure.file} failed to decode as ${failure.kind} and ${recovered.has(failure.file) ? 'decoded later' : 'stays a stand-in'}`, failure.errors);
  for (const report of reportFailures(loaded.failures, loaded.bank.size, recovered, soundOptions.support)) reportError(report);
}
const boot = BootScreen.adopt();
const reporter = ERROR_REPORT_URL ? new ErrorReporter(ERROR_REPORT_URL, gameContext) : null;
if (reporter) onReport((err) => void reporter.report(err));
const surface = openWebGL(document.createElement('canvas'), GAME_GL);
const mixer = new Mixer(MIX);
mixer.unlockOn(window);
bootStep('loading physics, models and sounds');
const soundOptions: BankOptions = { expectedBytes: SFX_BYTES, support: formatSupport(), progress: boot.count('sounds') };
const loading = Promise.all([
  boot.track('physics', initPhysics()),
  boot.track('models', loadModels(undefined, boot.count('models')).then(reportStandIns)),
  boot.track('sounds', loadBank(mixer.ctx, SOUNDS, soundOptions)),
]);
bootStep('loading the map');
const map = await boot.track('map', fetchMap());
const slots = await openSaves(saveKey, window.localStorage, allSlots(CONFIG.saveSlots));
persistSaves().catch(reportError);
const newGameActions: NewGameActions = {
  requestBoot: (request) => requestBoot(window.sessionStorage, saveKey, request),
  reload: () => void slots.flush().then(() => window.location.reload(), reportError),
  confirm: (text) => window.confirm(text),
};
bootStep('loading the save');
const { world, runId, loadedFrom, fresh } = await bootWorld();
const log = new RunLog(slots.backend, runId, (err) => slots.onError(err));
log.begin(world, loadedFrom);
bootStep('building the ground');
await boot.track('ground', () => groundTexture(world));
bootStep('waiting for physics, models and sounds');
const [, , loadedBank] = await loading;
const { bank } = loadedBank;
if (loadedBank.format !== BANK.formats[0].ext) console.warn(`Sounds play from the ${loadedBank.format} twins, since ${BANK.formats[0].ext} did not decode`);
for (const failure of loadedBank.unreachable) console.warn(`Sound ${failure.file} could not be fetched`, failure.errors);
bootStep('starting the game');
const radio = new RadioPanel(new RadioStation(Math.random));
const soundSettings = new SoundSettings(mixer, window.localStorage, radio.faceplate, radio.keys, () => game.loops.nextTrack());
radio.hear(world);
const overlay = element('overlay');
const game = await boot.track('scene', () => new Game(world, { slots, runId, log, mapHash: world.mapHash }, element('game'), overlay, new SoundPlayer(mixer, bank, SOUNDS), () => soundSettings.toggleMute(), radio, surface));
if (questJump) game.screens.quest.jump(questJump.picks, questJump.page);
relocalizeGame = () => {
  game.relanguageQuest();
  radio.relocalize();
  game.uiStale = true;
};
const view = { focus: () => game.rig.focus(), setSpeed: (factor: number) => game.follow.keyPan.setSpeed(factor) };
const opening = startKit(modeKit(world.setup.mode, CONFIG.startKit)).opening;
if (fresh && opening) game.hud.note(world, t(`opening.${opening.log}`), "");
const debugConsole = new DebugConsole(uiRoot(), game, mountPerfPanel(overlay), new Noclip(game, view, PHYSICS.metersPerTile));
keepRunningOnErrors((text) => debugConsole.error(text));
onEveryError(() => game.holdSaves());
bootStep('running');
if (loadedBank.failures.length) whenVisible(() => void recoverSounds(loadedBank).catch(reportError));
gameContext.watch({ world: () => game.state, log: () => game.logTexts(), slots });
performance.mark('roam:ready');
void boot.finish();
if (import.meta.env.DEV) {
  (window as any).__ROAM__ = Object.assign(game, { language });
  (window as any).__ROAM_PERF__ = { snapshot: perfSnapshot, reset: resetPerf };
}

function freshSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) | 0;
}

function freshRunId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
