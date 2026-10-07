// Text the hard-coded text scan lets through, each with its reason. A dev page or the debug console stays English, and
// a brand stays as it is. text '*' lets every finding in the file through. The scan fails on an entry nothing uses.
// See docs/architecture/text.md for the excluded surfaces and their follow-ups.
export type Untranslated = { file: string; text: string; reason: string };

const DEBUG_CONSOLE = 'The debug console is a dev tool. It stays English.';
const DEV_REPORT = 'Progression and income reports are dev tools read in a terminal. They stay English.';
const SVG = 'Static SVG markup of an icon, with no words in it.';

export const UNTRANSLATED: readonly Untranslated[] = [
  { file: 'src/ui/console.ts', text: '*', reason: DEBUG_CONSOLE },
  { file: 'src/sim/cheats.ts', text: '*', reason: 'Cheats answer the debug console, a dev tool. Their words stay English.' },
  { file: 'src/ui/perf-panel.ts', text: '.textContent =', reason: 'The perf panel is a dev readout of frame timings. It stays English.' },
  { file: 'src/three/icons/page.ts', text: '*', reason: 'icons.html is a dev page for checking the icon sheets. It stays English.' },
  { file: 'src/data/sounds.ts', text: '*', reason: 'Sound prompts feed the dev sound generator and the sound board, never the player.' },
  { file: 'src/data/npc-behavior.ts', text: '*', reason: 'Driver first names and surnames are proper names. They stay in Latin script in every language.' },
  { file: 'src/sim/progression/income-report.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/progression/income.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/progression/record.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/progression/replay.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/progression/bot.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/testkit.ts', text: 'Test Driver', reason: 'The test kit names its trucks for tests. No game code calls it.' },
  { file: 'src/data/region.ts', text: 'Icarus', reason: 'The map name is an id the bake and the tests read. No screen shows it.' },
  { file: 'src/sim/terrain.ts', text: 'Prop   group', reason: 'A label inside a map file write error, which only a bake shows.' },
  { file: 'src/sim/terrain.ts', text: 'Prop   step', reason: 'A label inside a map file write error, which only a bake shows.' },
  { file: 'src/three/travel.ts', text: 'Turn worker failed:  ', reason: 'An internal error the turn throws to the console and the bug report, never shown in words.' },
  { file: 'src/three/travel.ts', text: 'Could not read turn worker response', reason: 'An internal error the turn throws to the console and the bug report, never shown in words.' },
  { file: 'src/three/crash.ts', text: 'Error:  ', reason: 'The prefix of an error line in the debug console, a dev tool.' },
  { file: 'src/three/crash.ts', text: '.textContent =', reason: 'The crash screen shows the raw error and its stack for a bug report.' },
  { file: 'src/ui/cards.ts', text: '.innerHTML =', reason: SVG },
  { file: 'src/ui/sound.ts', text: '.innerHTML =', reason: SVG },
  { file: 'src/text/en/screens.ts', text: 'Русский', reason: 'Each language names itself in its own words on the language control.' },
];
