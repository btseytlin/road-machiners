# Text and languages

Every word a player reads comes from one catalog in `src/text/`, in English and Russian. The sim keeps ids and numbers, and the text layer turns them into words in the active language. A switch of language rewrites the words on screen in place, with no reload, and changes nothing in the world or a save.

## Keys, params and kinds

- English defines every key in `src/text/en/`. An entry without params is a plain string. An entry with params is `m(text, schema)`, where the schema names each param's kind:
  - `int`: a grouped integer, like 1,200 or 1 200.
  - `dec`: at most one decimal, like 2 or 1.5.
  - `dec1`: always one decimal, like 20.0.
  - `count`: an integer that picks plural forms.
  - `text`: a nested message.
  - `name`: a proper name shown as it is, like a driver's name.
- Russian in `src/text/ru/` gives a string for every English key. Its type maps the English keys to strings, so a missing key fails tsc.
- Keys group by area: `screens` for panels and menus, `log` for the log and the sim's ids, `talk` for radio talk and J.J.'s broadcasts, `names` for data names. A key names its part of the game and its id, like `goal.lowFuel`, `part.mg`, `line.dealTerms` or `radio.dawn.2`.
- The message syntax is a strict ICU subset: `{name}` and `{n, plural, one {...} few {...} many {...} other {...}}`, where `#` is the formatted count. A literal brace is not allowed. `src/text/resolve.ts` alone parses and resolves it.
- `t(key, params)` builds a `Msg`, a key with its params, typed by the English schema. `verbatim(name)` wraps a proper name, `num(n, kind)` a number shown on its own, `list(items)` a comma list, `concat(items)` pieces shown one after another, like the colored spans of a log line, and `date(ms)` a real time. A `Msg` turns into words only where it is shown.
- `src/text/names.ts` gives the words of an id: `partName`, `goodName`, `siteName`, `vehicleTitle`, `goalText`, `noteText`, `refusalText` and the rest. A key is built from an id there and nowhere else. Never build a key from text, and never join translated fragments into a sentence. A sentence with values is one entry with params.
- Numbers and plurals use `Intl.NumberFormat` and `Intl.PluralRules` for `en-US` and `ru-RU`. Russian groups with a no-break space and uses a decimal comma. Real times use `Intl.DateTimeFormat`. Units are part of an entry's words, like `{n} km` and `{n} км`.

## Ids in the sim

The sim never imports `src/text/` and never makes English. `src/sim/types.ts` declares its vocabulary:

- `GoalReason`: why a driver took up or ended a goal, shown under its name.
- `SimNote`: a log note with its numbers, in `info` and `supply` events.
- `MoneyReason`: why money moved.
- `Refusal`: why a player command was turned down. A command throws `Refused` from `src/sim/world.ts`, and the UI shows the refusal in words. Any other error is a bug: the UI shows "That did not work." and logs the error to the console.
- `UnitId`: the unit of a counted call value.
- `LineId` in `src/data/dialogue.ts`: every radio line, by id. A call keeps the id of the line said last.

A truck has no saved name. Its title comes from the player's own truck or from its template's profession and its driver. A bounty names its target by template. Save step 19 to 20 maps old saves to the ids, as [Saves](saves.md) describes.

## The active language and live text

- `src/text/language.ts` owns the active language. It stores the choice under `roam.lang` in local storage, apart from the save keys, so a new game, a load and a boot keep it. The default is English unless `roam.lang` says otherwise. Nothing reads the browser's language.
- `?lang=pseudo` picks the dev-only pseudo locale, never stored. It pads English by 40% with accented letters inside ⟦⟧, to show which layouts break on longer text.
- `el()` in `src/ui/dom.ts` takes only messages as text. A `Msg` child becomes a bound text node, and a `Msg` title, aria-label, aria-valuetext, placeholder or alt a bound attribute. `setText()` writes a message into a view that redraws every frame and skips an unchanged one.
- On a switch, `relocalize()` rewrites every bound node under `#ui` and the map overlay once, then the game redraws its panels and the radio shows its broadcast again. Old log lines keep their messages, so they switch too. `confirm()` text and canvas text resolve when shown, through `say()`.
- The language control, `LanguageSwitch` in `src/ui/language-switch.ts`, is the last row of the game menu and sits in the header of the boot save screens. Each language is named in its own words.
- Barlow Semi Condensed has no Cyrillic. Fira Sans Condensed, after it in `--font-ui`, draws the Cyrillic glyphs. IBM Plex Mono covers Cyrillic on its own.

## Adding a language

1. Add the locale to `Locale` and `LOCALES` in `src/text/msg.ts` and its `Intl` tag in `src/text/resolve.ts`.
2. Add a folder like `src/text/ru/` with the same area files. tsc then lists every missing key, and the catalog test checks params and the language's plural forms.
3. Add a button label `language.<locale>` in every language, and the language's banned in-character words to `src/text/catalog.test.ts`.

## The checks

All of them run in `npm test` and `npm run typecheck`. Together the text tests take about 5 seconds.

- tsc: a missing key in a language, a wrong param, or a string passed to `el()` as text fails to compile. So does an id of a closed union, like a goal reason, without its words.
- `src/text/catalog.test.ts`: every entry parses in every language, uses exactly its schema's params, and has exactly the language's plural forms (`one, other` in English and `one, few, many, other` in Russian). No Russian entry may copy its English, apart from a short list of brands and language names. Radio talk and broadcasts hold none of the out-of-character words, like turn, level or save, and ход, уровень or сохран.
- `src/text/coverage.test.ts`: every data id the game can show, like each part, chassis, good, template, site, terrain, trait, skill, perk, radio line and broadcast, has its words in every language.
- `src/text/scan.test.ts`: it parses every production file of `src/ui`, `src/three`, `src/sim`, `src/data`, `src/render` and `src/text` with `oxc-parser`. It fails on a prose literal, on a text sink like `.textContent =`, `.title =`, `setAttribute` of a text attribute or `confirm()` without `say()`, on `.innerHTML =`, on Cyrillic outside `src/text/ru/`, and on `as Msg`, `new Msg` or `verbatim` of a literal outside `src/text/`. Each failure prints `file:line`, the rule and the literal.
- `src/text/fixtures.test.ts`: an old save migrates, and every goal, call, contract and truck title it holds reads in both languages.
- `src/sim/text-free.test.ts`: a seeded world played for 120 turns holds no phrase in its events, goals or call.
- `npm run layout`, below, checks the real DOM. `npm run playtest` switches to Russian from the menu, checks the HUD and the log, and checks that the choice outlives a reload.

### The allowlist

`src/text/untranslated.ts` lists text the scan lets through, as `{ file, text, reason }`. Every entry needs a reason, and an entry nothing uses fails the scan. Missing Russian never falls back to English: there is no fallback path at all. New text ships its English and Russian entries in the same change.

### The layout check

`npm run layout` runs `scripts/layout-check.mjs` against the dev server. It boots a new game on seed 4242 through `?seed=`, and in English, Russian and pseudo at 1280×720 and 700×800 it opens eleven screens: the menu, the log with forty long lines, the inventory with an item card, the shop, the market, the trucks tab, a radio call on the hub and on a deal, the help guide, the character sheet and the save panel. `src/ui/dom.ts` measures each one and reports:

- `page-overflow`: the page scrolls sideways.
- `clipped-text`: text overflows a box that clips it. Ellipsis passes only with the full text in a title.
- `text-escapes`: a text box pokes out of the box that clips it.
- `control-overlap`: two visible controls overlap.
- `unreachable-control`: a click at a control's center, once scrolled into view, lands on something else.
- `missing-glyphs`: the Cyrillic face is not loaded.
- `leak`: Latin words in Russian, apart from bound names, driver names, key caps and brands.

Each fault prints the screen, language, window size, a CSS path, the text, the sizes and the kind, and `tmp/layout/faults.json` keeps them. Every screen is captured to `tmp/layout/<screen>-<language>-<w>x<h>.png`. Before the screens, the check plants a 40 px button with a long label and fails unless the checker reports it. A text check skips text a box scrolls, decoration hidden from screen readers and screen-reader-only labels. While a modal is open, only its controls count. The run takes about 8 minutes on a slow machine with software drawing.

## Excluded on purpose

Each of these stays as it is, with a follow-up where one makes sense.

- The debug console, the cheats it runs, the full shop it opens, the perf panel, `icons.html`, `sound.html` and the progression and income reports are dev tools. They stay English. The full-log debug lines go through the catalog but name goal kinds as the code does.
- The crash screen shows the raw error and its stack, for a bug report. Its title and hint are translated.
- Internal `Error` messages are for the console and bug reports. No `Error` message is shown to a player.
- Driver names stay in Latin script in every language, as proper names. They are rolled from `nameRng` and stored in saves. Follow-up: a Cyrillic name list, which needs a save step and a decision on the name roll.
- The game title "Road Machiners", the station "WOT RADIO" and "FM 66.6", and each language's own name on the language control stay as they are.
- Keyboard keys keep their caps, like WASD, Shift and Esc in the help guide.
- `docs/wiki/` stays English. It reads the English catalog.
- Follow-up: a native speaker's pass over the Russian copy.

## Russian glossary

- truck: грузовик. Player-facing text says «вы»; drivers say «ты» to each other.
- raider: рейдер. Scavenger: мусорщик. Vulture: стервятник. Roamer: бродяга. Trader: торговец.
- scrap: лом, scrap metal: металлолом. Wreck: обломки. Loot: добыча.
- tow: буксир, to tow: тащить на буксире. Patch: ремонт, to patch: подлатать.
- parked: на стоянке. Pad: площадка. Garage storage: гараж.
- skill: умение. Perk: навык. XP: опыт. HP of a part: ПЧ, прочность.
- turn: ход, never on the radio.
