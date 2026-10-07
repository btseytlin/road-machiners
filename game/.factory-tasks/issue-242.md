# Issue 242: Menu button for New Game, Save, Load and Help

**Status:** planning
**Branch:** factory/issue-242
**Worktree:** none (factory clone)
**Mode:** hands-off
**Goal:** During play, one **Menu** button in the top right replaces the Save, Load and New game buttons and the `?` guide. It opens New Game, Save, Load and Help. Help shows the old controls guide. New Game opens a setup screen. Back leaves the world as it was. A confirmed Start begins a new world with the manual slots kept. The death screen and the broken-save screen reach the same setup screen. A browser check at 1600×900 and 640×800 shows all of this, with screenshots.

## Context

- `src/ui/game-menu.ts:19-47` `GameMenu` puts three buttons, Save, Load and New game, into the `.top-right` row beside the camera switch. `refresh()` disables all three while a turn plays (`isBusy`). It also disables Load when no slot is filled (`hasSave`).
- New game in that menu runs `window.confirm(CONFIRM_NEW_GAME)` and then `startNewGame()` (`game-menu.ts:13-17`). That writes the `'new'` boot request and reloads. Boot then runs `freshRun()` (`src/three/main.ts:65-68`), and `clearGame()` there deletes `auto`, `day` and the tips but keeps the manual slots (`src/three/save.ts:30-34`, tested in `save.test.ts:49`).
- The death screen's New game (`src/ui/death.ts:42`) calls `startNewGame()` without any confirm.
- The broken-save screen `chooseSaveFate()` (`src/ui/save-screen.ts:13-37`) has its own New game behind the same confirm. It runs at boot, before `Game` exists, and resolves a promise. Issue #242 calls this route "rescue".
- The `?` guide is a `<details>` in its own `.help` panel. It is built in `Hud` (`src/ui/hud.ts:102,145-150,172-188`), sits first in the `.top-left` row before the `!` feedback menu, and opens to the size of the inspection panel (`style.css:786-804`). Escape closes it. It holds the controls text and `versionLabel()`.
- `Game.modalOpen()` (`src/three/game.ts:375-377`) already counts `menu.isPanelOpen()`. While it is true, Space does not play a turn, `noModal` keys are ignored, canvas clicks do not order or target (`onLeftClick`), and auto travel pauses (`game.ts:913`). Keys without `noModal`, like C, I, F, M and V, still work under a modal.
- `SavePanel` (`src/ui/save-panel.ts`) is a centered `.save-panel` with a shade (z-index 60). It closes on Escape through a capture-phase listener that stops propagation. `.death` sits at z-index 50.
- `scripts/playtest.mjs:83-88` clicks the `.help` corner and expects it to open and then close on Escape. `findDeadCorners` expects at least 4 visible one-control panels.
- Vitest runs in Node without a DOM (`vitest.config.ts`, and no jsdom or happy-dom anywhere). DOM behavior is therefore checked in the browser.
- Neither the code nor `origin` has issue #243 (Roaming mode selector), and the word "Roaming" appears nowhere in `src/` or `docs/`.
- Docs that name the old controls: `docs/architecture/saves.md:6,16,20`, `docs/publishing.md:22` ("The `?` menu shows the version") and `docs/wiki/mechanics/defeat.md:40`.

## Design

This is a UI-only change in `src/ui/` plus wiring in `src/three/game.ts`. It changes no sim rule, no saved type and no boot request format.

**Menu (`GameMenu`, `src/ui/game-menu.ts`).** The `.game-menu` panel in `.top-right` holds one button labeled `Menu`. The button carries `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`. Clicking it toggles a dropdown, a `role="menu"` list of four `role="menuitem"` buttons in this order: New Game, Save, Load, Help. The dropdown hangs right-aligned under the button, stays inside the viewport at any width (`max-width: calc(100vw - 28px)`), and sits above the HUD panels but below `.death` (z-index 45).
- Entry states follow the old buttons. Save and New Game are disabled while busy. Load is disabled while busy or when no save exists. Help is always enabled. The Menu button itself is always enabled, so Help can open while a turn plays. `refresh()` updates the states while the dropdown is open, too.
- When the dropdown opens, focus moves to the first enabled entry. ArrowDown, ArrowUp, Home and End move focus among the enabled entries. Enter or Space activates an entry. Escape closes the dropdown and returns focus to the Menu button.
- **Overlay isolation.** While the dropdown is open, it owns the input:
  - A capture-phase `keydown` listener on `window` stops propagation of every key except browser chords (`isBrowserChord`). Navigation keys keep their default actions, so Enter, Space and Tab still work, and no game key fires.
  - A capture-phase `pointerdown` on `window` outside the menu closes the dropdown. It calls `stopPropagation()` and `preventDefault()` so the click never reaches the canvas or another control.
  - Moving focus out of the menu with Tab also closes it.
  - The dropdown also counts in `Game.modalOpen()`, which pauses auto travel and hides the path and hit card, like a panel.
- Choosing an entry closes the dropdown first, then acts:
  - Save and Load call the existing `SavePanel.openSave()` and `openLoad()` without any change to the panel.
  - Help toggles the Help panel.
  - New Game opens the setup screen.
- `GameMenu.isOpen()` replaces `isPanelOpen()`. It is true while the dropdown, a save panel or the setup screen is open. It stays false for Help, which is not modal.

**Help panel (`HelpPanel`, new `src/ui/help.ts`).** The controls guide moves here word for word from `hud.ts`, including the version line. Help opens as a `.help` panel first in `.top-left`, where the old guide opened and at the same inspection size, with the heading "Controls" and a Close button. It stays non-modal like the old `<details>`, so the player can keep driving while it is open. Escape, its Close button and the Help entry close it. `Hud` loses the guide, keeps the `!` feedback menu, and its Escape listener closes only the feedback menu. `GameMenu` owns the `HelpPanel`, as it owns the `SavePanel`.

**New game setup (`chooseNewGame()`, new `src/ui/new-game.ts`).** The one New Game flow and the entry point #243 extends.
- `chooseNewGame(): Promise<boolean>` shows a centered modal with the shade (it shares the `.save-panel` look, z-index 60, above `.death`). It has the heading "New game", the line "Mode: Roaming", the dim line "The autosaves are deleted. Your save slots stay." and the buttons Back and Start. Focus starts on Back.
- Start runs `window.confirm(CONFIRM_NEW_GAME)`. A yes resolves `true`. A no leaves the screen up.
- Back, or Escape through a capture-phase listener that stops propagation, removes the screen and resolves `false`.
- The screen never touches storage or the world. Each caller decides what a start does:
  - Menu and death screen: `if (await chooseNewGame()) startNewGame(requestBoot)`. That is the same `'new'` boot request and reload as today, so `clearGame()` still deletes only `auto`, `day` and the tips.
  - Broken-save screen: `if (await chooseNewGame()) done('new')`. Its own confirm goes, since Start confirms. The fate screen stays under the setup screen, so Back returns to it.
- `startNewGame()` and `CONFIRM_NEW_GAME` move into `new-game.ts`, which owns starting a new game.
- #243 replaces the body (mode selector, settings) and the resolved value (settings instead of `true`). All three callers already pass through this one function.

**Death screen.** New game calls `chooseNewGame()`. Back leaves the death screen as it was. This adds a confirm the death route never had, because the issue says a start is always confirmed.

**Approaches considered.**
- (A, chosen) A promise-returning setup screen that the callers share. This matches `chooseSaveFate()`, needs no new state on `Game`, and works at boot, where no `Game` exists.
- (B) A setup class owned by `Game`. It cannot serve the boot screen without a second implementation.
- (C) Keep the immediate confirm and reload. The issue rules this out.

**Backwards compatibility.** Saves, storage keys and boot requests are unchanged. The only consumer of `.help`, `.game-menu` and `isPanelOpen()` outside `src/ui/` is `scripts/playtest.mjs` and `game.ts`, and both are updated here.

TDD: no. The logic is DOM wiring, and Vitest has no DOM here. The one pure piece, the entry states, gets a unit test written together with it. Behavior is proven by the browser check script and `npm run playtest`.

### Invariants

- IV1: While the menu dropdown, a save panel or the setup screen is open, no key or click sets an order, plays a turn, targets or fires. `GameMenu.isOpen()` feeds `Game.modalOpen()`, and the dropdown swallows keys and click-aways.
- IV2: `chooseNewGame()` writes no storage and changes no world. Only a `true` result lets the caller start, and only after `window.confirm` says yes.
- IV3: Entry states equal the old button states. Save and New Game are disabled while busy. Load is disabled while busy or when no save exists. Help is always enabled.
- IV4: The controls guide text and the version line appear in one place only, `HelpPanel`.
- IV5: Every New Game route (Menu, death screen, broken-save screen) goes through `chooseNewGame()`.

### Principles

- PC1: The menu dropdown, the save panels and the setup screen are drawn above every HUD panel. `.death` stays above the dropdown, and a modal panel opened from the death screen stays above `.death`. Nothing opened from the menu disables the Menu button except a modal shade.
- Project principles: this change touches no sim rule, no hot loop, no value, no saved type and no randomness. Principle 2 is the one that applies: the UI reads `hasSave` and the boot request through `saveStore` (`src/three/save.ts`) and keeps no rule of its own. Principle 7: opening `chooseNewGame()` while one is already open is a bug, so it throws.

### Assumptions

- AS1: "Mode: Roaming" is a plain text line until #243 lands. The issue names the existing defaults "Roaming". #243 owns the selector and its words.
- AS2: The Start button plus the native `window.confirm` is the "explicit, confirmed action", which matches how Load and the old New game confirm.
- AS3: Help stays non-modal like the old `?` guide, so the controls can be read while driving.
- AS4: "death/rescue New Game route" means the death screen and the broken-save boot screen (`save-rescue.ts`). Both go to setup.

### Unknowns

- UK1: Whether #243 reaches `main` before execution. PH1 checks `git log origin/main` for a new-game setup screen. If one exists, its entry point replaces `chooseNewGame()` and the plan's PH2 shrinks to wiring.

### Reference images

The issue has no reference images. Its normal and narrow screenshots are evidence that the change works, not a look to match.

### Hands-off decisions

- udesign: setup screen is a promise function shared by three callers. It is the only way to serve the boot screen without a second setup.
- udesign: Start keeps the native confirm. The issue asks for a confirmed start, and Load already confirms this way.
- udesign: the death screen New game gains the confirm. The issue makes every start confirmed.
- udesign: the dropdown swallows all non-chord keys while open. This is the simplest rule that keeps game keys out of the overlay.
- udesign: Help stays non-modal in the top-left spot of the old guide. This keeps the guide's current behavior.
- udesign: the Menu button stays enabled while a turn plays, so Help is reachable. Busy disables only the entries the old buttons disabled.
- uplan: plan auto-approved.

## Plan

Approach: PH1 builds the two new UI units and the menu. PH2 rewires the callers, the CSS, the playtest and the docs. PH3 is the browser check. The browser check is the only proof of the DOM behavior, so it is a required phase, not an option.

### PH1 — Menu, Help panel and setup screen

- 1.1 `src/ui/new-game.ts` (create). It owns starting a new game.
  - `export const CONFIRM_NEW_GAME`, moved from `save-screen.ts:11` with the same text.
  - `export function startNewGame(requestBoot: (request: "new") => void): void`, moved from `game-menu.ts:13-17` without change.
  - `export function chooseNewGame(): Promise<boolean>`. It builds the screen described in Design with `panel("save-panel new-game")`, `role="dialog"` and `aria-label="New game"`. It holds a module-level `open` flag and throws `Error("New game setup is already open")` when called while open (Principle 7). Escape works through a capture-phase `keydown` with `stopPropagation`. Removing the screen also removes the listener.
  - Respects: IV2, AS1, AS2.
- 1.2 `src/ui/help.ts` (create). `class HelpPanel` owns the controls guide.
  - `isOpen(): boolean`, `open(): void`, `close(): void`, `toggle(): void`.
  - `open()` prepends `panel("help")` to `topLeft()` with an `h3` "Controls", a `button.close` "Close", and the eight `div` lines plus `div.version` moved verbatim from `hud.ts:178-187`. `close()` removes the panel.
  - A `keydown` listener for Escape is added on open and removed on close. It is bubble-phase and does not stop propagation, so Escape still closes other screens as it does today.
  - Respects: IV4, AS3.
- 1.3 `src/ui/game-menu.ts:1-47` (rewrite). Update the header comment.
  - `export type MenuEntry = "new" | "save" | "load" | "help"`.
  - `export function entryEnabled(entry: MenuEntry, busy: boolean, hasSave: boolean): boolean` is a pure query for IV3.
  - `class GameMenu`:
    - The constructor signature is unchanged: `(actions: GameMenuActions, isBusy: () => boolean)`.
    - Fields: `root` (`.game-menu` in `topRight()`), `button` (Menu), `list` (`div[role=menu]`, hidden, with id `game-menu-list`), `items: Record<MenuEntry, HTMLButtonElement>`, `savePanel`, `help = new HelpPanel()`, `choosing = false`.
    - `isOpen(): boolean` is the dropdown, or `savePanel.isOpen()`, or `choosing`.
    - `refresh()` sets each item's `disabled` from `entryEnabled`.
    - `toggle()` opens or closes the dropdown.
    - Private `openList()` shows the list, sets `aria-expanded`, refreshes, focuses the first enabled item, and adds the capture listeners `onKey` and `onPointer` on `window` plus `focusout` on `root`.
    - Private `closeList(returnFocus: boolean)` reverses that.
    - `onKey` turns Escape into `closeList(true)`. ArrowUp, ArrowDown, Home and End move focus among the enabled items with `preventDefault`. Every non-chord key gets `stopPropagation`.
    - `onPointer`, for a target outside `root`, runs `closeList(false)`, `stopPropagation` and `preventDefault`.
    - Private `choose(entry)` runs `closeList(false)` and dispatches. `"new"` runs `newGame()`, which sets `choosing = true`, awaits `chooseNewGame()`, sets `choosing = false`, and calls `startNewGame(this.actions.requestBoot)` on `true`.
  - Respects: IV1, IV3, IV5, PC1.
- 1.4 `src/ui/game-menu.test.ts` (create). Tests `entryEnabled` across busy × hasSave for all four entries (IV3).
- Commit: "One Menu button opens New Game, Save, Load and Help, with a New game setup screen".

### PH2 — Callers, layout, playtest and docs

- 2.1 `src/ui/hud.ts:7,102,145-150,172-188`. Remove `help`, `guide` and its lines. The Escape listener closes only `feedbackMenu`. Drop `topLeft` from the imports only if it is unused (the feedback panel still uses it, so keep it).
- 2.2 `src/ui/death.ts:1-45`. Replace the `startNewGame` import with `chooseNewGame` and `startNewGame` from `./new-game`. The New game button runs `async () => { if (await chooseNewGame()) startNewGame(this.actions.requestBoot); }`. Update the header comment. Respects: IV5.
- 2.3 `src/ui/save-screen.ts:11-24`. Remove `CONFIRM_NEW_GAME` (it moved). `confirmNew` becomes `async () => { if (await chooseNewGame()) done('new'); }`. Respects: IV5, AS4.
- 2.4 `src/three/game.ts:376`. `this.menu.isPanelOpen()` becomes `this.menu.isOpen()`. No other change in `game.ts`. Respects: IV1.
- 2.5 `src/ui/style.css`:
  - `:755-804`: keep `#ui .help` and turn the `details` rules into rules for the panel itself (`.help` at the inspection width and height, `max-width: calc(100vw - 30px)`, `overflow: auto`, `.help h3`, `.help .close`, `.help > div`, `.help .version`). Remove the `.help summary` and `.help details[open]` rules. Keep the `.feedback` rules unchanged.
  - `:1613-1617`: `.game-menu` becomes `position: relative`.
  - Add `.game-menu [role=menu]`: absolute, `right: 0`, `top: calc(100% + 4px)`, z-index 45, a column of full-width buttons, `min-width: 160px`, `max-width: calc(100vw - 28px)`, and the panel background and border.
  - Add `.new-game` beside `#ui .save-panel` (`:2155`) for the mode line and a right-aligned button row.
  - Respects: PC1.
- 2.6 `scripts/playtest.mjs:83-88`. Replace the help check: click the `.game-menu` corner, expect `[role=menu]` visible, press Escape, expect it hidden. Open again, click Help, expect `.help` visible, press Escape, expect `.help` gone. Keep the one-control count at 4 or more; the Menu panel replaces the `?` panel there.
- 2.7 Docs:
  - `docs/architecture/saves.md:6,16,20`: the Menu opens Save and Load, Help shows the version, and every New game opens the setup screen in `src/ui/new-game.ts`.
  - `docs/publishing.md:22`: "The Help entry of the Menu shows the version".
  - `docs/wiki/mechanics/defeat.md:40`: New game opens the new game setup and starts on a confirmed Start.
  - Add a line to `docs/architecture/render.md` (the Rendering and UI doc) naming `src/ui/game-menu.ts` as the owner of the Menu and `src/ui/new-game.ts` as the one New Game flow.
- Commit: "Death, broken-save and menu New Game share the setup screen, and Help moves into the Menu".

### PH3 — Browser check and screenshots

- 3.1 `tmp/menu-check.mjs` (not committed). Use Playwright on the dev server with the GPU flags from `docs/tools.md`. Accept dialogs with `page.on('dialog')` (dismiss for the cancel case, accept for the start case). Run it at 1600×900 and 640×800.
  - Layout: `.game-menu` is visible, and the old Save, Load and New game buttons and the `.help summary` are gone. Open the menu. Each of the four entries is visible inside the viewport, and `elementFromPoint` at its center hits that entry (PC1). Screenshot `menu-open-{normal,narrow}.png` and `menu-closed-{normal,narrow}.png`.
  - Keyboard: Enter on the focused Menu button opens it. ArrowDown moves focus. Escape closes it and focus returns to Menu. While open, pressing Space, R, Q and 1 leaves `__ROAM__.state.turn` and the player order unchanged and does not play a turn (IV1).
  - Click-away: with the menu open, click the canvas on open ground. The menu closes and the player's `order` is unchanged (IV1).
  - Help: opening it shows the controls lines and the version, with a screenshot. A turn can play with Help open. Escape closes it.
  - Save and Load: Save opens the slot panel, and clicking a slot fills it. Close returns to play with the menu closed. While a turn plays, the Save, Load and New Game entries are disabled and Help is enabled. On a fresh profile with no save, Load is disabled (clear storage, reload).
  - New Game cancel: click Back, then Escape. Each time the world turn, the vehicle position and localStorage are unchanged. Start with a dismissed confirm also changes nothing. Screenshot the setup screen at both sizes.
  - New Game start: fill slot 1 first, then Start and accept. After the reload, slot 1 still exists, `auto` holds a new world (a new seed or turn 1), and `day` is gone or new.
  - Death route: set the player state to dead through `__ROAM__.apply`. The death screen's New game opens setup above it, Back returns to the death screen, and Start with accept starts a new world.
- 3.2 Run `npm test`, `npm run typecheck`, `npm run playtest` (with `--cpu` without a GPU) and `npm run quality` from the root.
- 3.3 Look at every screenshot. Write in the Verify section: the Menu sits in the top right beside the camera switch without overlapping it, the dropdown is not clipped at 640 px, the Help panel sits in the top left where the old guide opened, and the setup screen is centered above the shade.

### Test strategy

- Unit: `entryEnabled` (IV3) in `game-menu.test.ts`. `clearGame` keeps the manual slots, which `save.test.ts:49` already covers.
- Browser: `tmp/menu-check.mjs` covers IV1, IV2, IV5, PC1 and the screenshots. `npm run playtest` covers the open and close of Menu and Help.

### Order & dependencies

- PH1, then PH2, then PH3. PH2 consumes the PH1 exports, and PH3 needs both.

### Risks / rollback

- RK1: The capture-phase `pointerdown` swallow might block the save panel's own buttons. It is removed when the dropdown closes, and the dropdown closes before any panel opens. The browser check clicks a save slot to prove it.
- RK2: The `!` feedback menu shifts left now that the `?` panel is gone. The screenshot check covers it, and nothing anchors to it.
- Rollback: revert the two commits. No save or storage format changes.

### Interfaces

- IF1: `chooseNewGame(): Promise<boolean>`, `startNewGame(requestBoot)` and `CONFIRM_NEW_GAME` in `src/ui/new-game.ts`.
- IF2: `GameMenu.isOpen(): boolean`, which replaces `isPanelOpen()`.

### Interface graph

- PH1 -> IF1, IF2 @ src/ui/new-game.ts, src/ui/help.ts, src/ui/game-menu.ts, src/ui/game-menu.test.ts
- PH2 IF1, IF2 -> @ src/ui/hud.ts, src/ui/death.ts, src/ui/save-screen.ts, src/three/game.ts, src/ui/style.css, scripts/playtest.mjs, docs/
- PH3 IF1, IF2 -> @ tmp/menu-check.mjs

## Code smells

- `src/three/game.ts:495-523`: C and I (`toggleScreen`) and F, M and V still act under a modal save panel, because only `noModal` keys check `modalOpen()`. This is out of scope. The new dropdown swallows keys itself, and the save panel behaves as it does today. (GPC6)

## Conclusion

Built as planned. One commit holds both phases, because the pre-commit typecheck needs the callers rewired with the menu. `HelpPanel` lives in `src/ui/game-menu.ts`, not a separate `help.ts`, since the quality gate rejected another small file in `src/ui/` (fragmentation). No other plan deviation. #243 had not landed, so `chooseNewGame()` in `src/ui/new-game.ts` is the setup screen.

Checks: `entryEnabled` unit test, `src/ui` tests and `save.test.ts` pass, and `npm run typecheck` passes. Not run, per instructions: the full suite and `npm run playtest`. `scripts/playtest.mjs` now clicks Menu and Help instead of `?`.

Browser check (`tmp/menu-check.mjs`, software rendering, 1600×900 and 640×800), all passing except two false alarms in the script itself:
- "old buttons gone" matched the hidden menu entries named Save and Load.
- "Escape closes" came after the script pressed Space on the focused Save entry, which correctly opened the Save panel.
- Passing: Enter opens the menu, ArrowDown moves focus, and Space, R, Q and 1 changed nothing, apart from Space activating the focused entry. Click-away closes the menu without an order. Help shows the controls and version, and Escape closes it. Save writes a slot. Back, Escape and a dismissed confirm leave the world and storage unchanged. A confirmed Start reloads with slot1 kept.
- Not browser-tested: the death-screen and broken-save routes. They call the same `chooseNewGame()`.

### Visual self-review
Views read: `menu-closed`, `menu-open`, `help` and `setup` at both sizes, all in `tmp/`.
- Mismatch found and fixed: the Help Close button was absolutely positioned against the wrong box and overlapped the `!` button. `.help` is now `position: relative`. The `help-narrow` capture shows the fix.
- Checked: the Menu sits beside the camera switch without overlapping it. The dropdown stays inside the viewport at 640 px. Help opens top left at the old guide's spot and size. The setup screen is centered above the shade.
- Remains: the `help-normal` capture predates the Close fix. Software rendering made each browser run about 20 minutes, so I did not run another.

### Testing stage
Merged base (style.css conflict kept both sides). Fixed Help panel being drawn under the inspection panel at 640 px (`.top-left` z-index). Screenshots re-captured from the final build.

### Hardening round
Verify and review found no breaks. Run-time cost: the menu refreshes only on `refreshUi()` (as the old buttons did), and key and pointer listeners exist only while the dropdown is open. No added full scans or loop allocations. `src/ui` tests and typecheck pass. No fixes to unrelated failures.

### Round 2
Review finding 1 fixed: `chooseNewGame()` now adds a full-screen transparent `.new-game-block` layer (z-index 59) under the setup screen, so the Menu, death and fate New game buttons cannot be clicked while it is open. Typecheck and `src/ui` tests pass. Not browser-checked.

## Conclusion (round 2)

- All 4222 tests passed. The only check failure was the playtest FPS gate (47.5 under 50) on a shared GPU machine, with no page errors. The change touches no rendering loop.
- The factory runs `playtest -- --no-fps-gate`, but the script had no such flag. Added it (skips only the FPS check) and documented it in docs/tools.md. Separate commit.
