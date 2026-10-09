// Text the hard-coded text scan lets through, each with its reason. A dev page or the debug console stays English, and
// a brand stays as it is. text '*' lets every finding in the file through. The scan fails on an entry nothing uses.
// See docs/architecture/text.md for the excluded surfaces and their follow-ups.
export type Untranslated = { file: string; text: string; reason: string };

const DEBUG_CONSOLE = 'The debug console is a dev tool. It stays English.';
const DEV_REPORT = 'Progression and income reports are dev tools read in a terminal. They stay English.';
const SVG = 'Static SVG markup of an icon, with no words in it.';

const MIGRATION_LABEL = 'A label inside a save migration error, which only the console and a bug report show.';
const SETTING_LABEL = 'A label inside a setup parse error, which only the console and a bug report show.';

export const UNTRANSLATED: readonly Untranslated[] = [
  { file: 'src/three/main.ts', text: 'confirm()', reason: 'The browser adapter shows text its caller already resolved with say().' },
  { file: 'src/three/save.ts', text: 'confirm()', reason: 'The browser adapter shows text its caller already resolved with say().' },
  { file: 'src/three/render/interiors/bowl.ts', text: 'stilt tank', reason: 'A label inside a site build error, which only a bake or a test shows.' },
  { file: 'src/three/render/shadowFilter.ts', text: 'float getPointShadow', reason: 'A GLSL snippet patched into the shadow shader, with no words in it.' },
  { file: 'src/three/save-migrations.ts', text: 'contract   reward', reason: MIGRATION_LABEL },
  { file: 'src/three/save-migrations.ts', text: 'call money', reason: MIGRATION_LABEL },
  { file: 'src/three/save-migrations.ts', text: 'call deal price', reason: MIGRATION_LABEL },
  { file: 'src/three/save-migrations.ts', text: 'call buy price', reason: MIGRATION_LABEL },
  { file: 'src/three/save-migrations.ts', text: 'call sell price', reason: MIGRATION_LABEL },
  { file: 'src/three/save-migrations.ts', text: '  waived fee', reason: MIGRATION_LABEL },
  { file: 'src/three/save-migrations.ts', text: 'money event', reason: MIGRATION_LABEL },
  { file: 'src/three/save-migrations.ts', text: 'aid paid', reason: MIGRATION_LABEL },
  { file: 'src/three/save-migrations.ts', text: 'vehicle   money', reason: MIGRATION_LABEL },
  { file: 'src/three/save-migrations.ts', text: 'player money', reason: MIGRATION_LABEL },
  { file: 'src/three/save-migrations.ts', text: 'cost basis', reason: MIGRATION_LABEL },
  { file: 'src/three/save-migrations.ts', text: 'pile   basis', reason: MIGRATION_LABEL },
  { file: 'src/sim/progression/activity.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/progression/job-checks.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/settings.ts', text: 'World setup', reason: SETTING_LABEL },
  { file: 'src/sim/settings.ts', text: 'world setup field', reason: SETTING_LABEL },
  { file: 'src/sim/settings.ts', text: 'World settings', reason: SETTING_LABEL },
  { file: 'src/sim/settings.ts', text: 'world setting', reason: SETTING_LABEL },
  { file: 'src/ui/console.ts', text: '*', reason: DEBUG_CONSOLE },
  { file: 'src/sim/cheats.ts', text: '*', reason: 'Cheats answer the debug console, a dev tool. Their words stay English.' },
  { file: 'src/ui/new-game.ts', text: 'confirm()', reason: 'The browser adapter shows text its caller already resolved with say().' },
  { file: 'src/ui/full-shop.ts', text: '*', reason: 'The full shop is a debug screen the console opens. It stays English.' },
  { file: 'src/ui/perf-panel.ts', text: '.textContent =', reason: 'The perf panel is a dev readout of frame timings. It stays English.' },
  { file: 'src/three/icons/page.ts', text: '*', reason: 'icons.html is a dev page for checking the icon sheets. It stays English.' },
  { file: 'src/data/sounds.ts', text: '*', reason: 'Sound prompts feed the dev sound generator and the sound board, never the player.' },
  { file: 'src/data/npc-behavior.ts', text: '*', reason: 'Driver first names and surnames are ids. Each language spells them in src/text/<locale>/drivers.ts.' },
  { file: 'src/sim/progression/income-report.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/progression/income.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/progression/record.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/progression/replay.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/progression/bot.ts', text: '*', reason: DEV_REPORT },
  { file: 'src/sim/testkit.ts', text: 'Jed Cobb', reason: 'The test kit names its trucks for tests. No game code calls it.' },
  { file: 'src/data/region.ts', text: 'Icarus', reason: 'The map name is an id the bake and the tests read. No screen shows it.' },
  { file: 'src/sim/market.ts', text: 'cargo value', reason: 'A label inside a haul input error, which only the console and a bug report show.' },
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
