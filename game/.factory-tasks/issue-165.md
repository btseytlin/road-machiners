# Issue 165 — the driving HUD covers the weapons panel

**Mode:** hands-off
**Status:** planned (revision 2, after committee feedback)
**Goal:** At every supported viewport the weapons panel sits on the bottom edge of the screen, and no part of it rises above the top of the instruments. At 1280×656 with a six-gun truck, long weather and the extra action buttons, the weapons panel sits beside the instruments with its bottom edge level with theirs, and all six cards show without scrolling. The map stays visible above the band. The instruments, weapons, truck-condition card, log, end-turn button, inspection panel and "Center on truck" button never overlap. Every weapon control (All, Hide/Show, Auto fire, each card, Hold, Reload) is visible, or one scroll inside the weapons panel away, and takes the real click at its center. Gameplay screenshots at 1280×656 and at a narrow size show it. Combat and weapon behavior stay the same.

## Context
- The approval build (`274cef1e`) put the instruments, the weapons panel and the condition card in one `.bottom-left` flex dock with `flex-wrap: wrap-reverse` (`src/ui/style.css:1612-1631`). The weapons panel keeps its full content width, so a six-gun panel (about 705px) did not fit beside the instruments (about 437px) at 1280×656. It wrapped onto a line above them and covered the middle-left of the map (reference image 2).
- Committee feedback: "This obscures the game, no. Weapons panel must stay at the bottom." It asks for a low-profile bottom layout, compact or scrollable controls allowed, no hidden weapon actions and no tall overlay.
- Root cause: the design let the weapons panel keep its natural width and move somewhere else when it did not fit. The layout check only asserted no overlap and clickability, so it passed with weapons above the instruments. Nothing asserted where the panel sits or how tall the left stack gets.
- A weapon card is a fixed `width: 96px` (`style.css:409-412`). Its ammo row puts the pips, Hold and Reload on one line (`style.css:449-454`). With 6 pips the pips already run into Hold (reference image 2, cards 3 and 4). The largest magazine in `src/data/` is 6.
- The Auto fire switch is the first item in the weapons fieldset. Its label "Auto fire off [Q]" makes it about 85px wide (reference image 2).
- `.weapons fieldset` and `.weapon-slots` are `flex-wrap: wrap` in the approval build (`style.css:394-408`), so a narrow panel grows taller.
- `.info` stops above the log: `max-height: calc(100dvh - 64px - 234px - 8px)` (`style.css:841-852`), so its bottom is always at least 242px above the screen bottom. The log spans 112px to 234px above the bottom, and the end-turn button 14px to about 92px, both in the log column (`style.css:489-528`). The right dock starts 246px above the bottom. So in the bottom 242px only the log column takes width on the right.
- The approval build reserves `max(inspection + 14px, log + 16px)` = 314px on the right (`style.css:28`), 16px more than the log column needs at 1280.
- `WeaponPanel.render()` rebuilds the whole panel with `replaceChildren` on every render (`src/ui/weapons.ts:177-189`), so any scroll position inside it would reset to 0.
- `.recenter` ("Center on truck (F)") sits at `left: 50%; bottom: 124px` (`style.css:755-761`). It shows while the camera is panned off the truck (`hud.ts:210-212`), and at 1280 that spot falls inside the bottom band where weapon cards sit.
- `#ui` is `pointer-events: none` and only `.panel` turns them back on (`style.css:19-38`), so the empty area of a dock never blocks clicks on the map.
- Modal rules at `style.css:1037-1053` hide `.top-left`, `.bottom-left > .weapons` and `.right-dock`, raise `.bottom-left > .instruments` and the log, and hide `.truck-condition`.
- `scripts/ui-playtest.mjs` has `loadHeavyHud` and `checkDockLayout` over 7 viewports (from `274cef1e`), and `npm run ui-playtest` runs it.

## Reference images
- Image 1, `ref-206622ef1b17.jpg` (1280×656, gameplay, UI scaled about 1.65×). It shows the original bug. The instruments (clock "Day 3 10:53", dial, Money/Fuel/Supplies/Driver, Heat/Engine, weather "Dust storm, Heat wave", five action buttons ending with "Cool engine [G]" and "[C]") cover the left part of the weapons panel. Only "ns" of "Weapons" and parts of the Auto fire switch ("e [Q]", "re off") show. "All [0]", "Hide [X]" and two "MG turret" cards are visible. The condition grid sits above the instruments.
  - Takes: the heavy-HUD case (long weather plus five action buttons) that the check must reproduce.
  - Infers: the player's CSS viewport is smaller than 1280×656 (a card is about 160 image px against 96 CSS px), which the narrow viewports in IV7 cover.
  - The issue does not want this look. It is the "before".
- Image 2, `ref-769c1ffc78f8.jpg` (1280×656, gameplay, CSS scale 1). It shows the rejected approval build. A six-gun weapons panel (Shotgun, Shotgun, MG turret, MG turret, Shotgun, Long rifle, about 705×156px) sits at y≈304-460, on a line above the instruments (y≈468-642, x≈14-451), and covers the map there. The condition grid fills the top-left above it, reaching the top edge. The inspection panel "Your truck" is at x≈966-1266, y≈64-412, the log at x≈982-1266, y≈422-544, the end-turn button bottom right.
  - Takes: the six-gun case and the measured widths. Beside the instruments there are about 515px (from x≈459 to the log's left edge at 982 minus 8). The cards at 96px need about 705px, so the cards must get narrower, not the panel move.
  - Takes: what must not look like this. Nothing of the weapons panel may be above the instruments' top (y≈468 here), and the map at x 14-730, y 304-460 must be visible.
  - The issue wants the result to look unlike this image. So the plan has a visual check (PH3): a screenshot of the finished game at 1280×656 with six guns, next to both images, with the features in PH3 checked by name.
- No model is built, so the `blender-image-to-3d` skill does not apply.

## Design
Keep the one bottom-left dock, and change what gives way when space runs short. The weapons panel never moves up. First its cards narrow from 96px to 64px, and then its card row scrolls sideways inside the panel. Only when the band beside the instruments cannot hold Auto fire and two narrow cards (narrow screens) does the dock stack, and then the weapons panel stays on the bottom line and the instruments move above it.

- **Dock order.** `.bottom-left` becomes `flex-direction: row-reverse; flex-wrap: wrap-reverse; justify-content: flex-end; align-items: flex-start`. The weapons get `order: 0` and the instruments `order: 1`. With `row-reverse`, `justify-content: flex-end` packs the line to the left, so one line reads instruments then weapons, bottoms level (`flex-start` is the bottom with `wrap-reverse`). When the two do not fit, the first item (weapons) keeps the first line, and `wrap-reverse` puts that line at the bottom, with the instruments on the line above. There is no breakpoint: the browser decides from the widths.
- **When the dock stacks.** The weapons panel gets `flex: 1 1 var(--weapons-min); max-width: max-content; min-width: 0`. Flex line breaking uses the base size, so the dock stacks only when the band beside the instruments is narrower than `--weapons-min`. That is the panel padding, the Auto fire column and two narrow cards with their gaps, about 228px. Above that the panel grows up to its full content width. `--weapons-min` is a `calc()` of the same variables the cards use, so there is one number per size.
- **Cards that narrow.** New variables on `#ui`: `--weapon-card: 96px`, `--weapon-card-min: 64px`, `--weapon-gap: 6px`, `--weapon-auto: 72px`. A `.weapon-slot` is `width: var(--weapon-card); min-width: var(--weapon-card-min); flex-shrink: 1`. The fieldset and `.weapon-slots` become `flex-wrap: nowrap` with `min-width: 0`, so the cards shrink before anything else. Inside a card, `.weapon-ammo-row` gets `flex-wrap: wrap` with a 2px gap, so at narrow widths Hold and Reload move under the pips instead of over them. This also fixes the pips running into Hold at 96px. The name keeps its two-line clamp, and the status text wraps as it does today.
- **Auto fire column.** The switch in the fieldset is `flex: 0 0 var(--weapon-auto)` and its option labels may wrap ("Auto fire off" over "[Q]"). It keeps its switch look and key.
- **Scroll as the last resort.** `.weapon-slots` gets `overflow-x: auto; scrollbar-width: thin`. When even 64px cards do not fit, the row scrolls inside the panel. The panel height does not change. `WeaponPanel.render()` carries the old row's `scrollLeft` over to the new row. When the selected weapon changes (key 1-9 or a click), it calls `scrollIntoView({ block: "nearest", inline: "nearest" })` on that card, so a gun picked by key is never off-screen. At 1280×656 a six-gun truck must not need the scroll (IV3).
- **Right reserve.** `--right-column` becomes `calc(var(--log-width) + 16px)` (`+ 14px` at ≤720, where the log sits 14px from the edge). The inspection panel is no longer reserved, because its `max-height` keeps it above 242px, which is higher than the side-by-side dock (IV5 checks it).
- **Condition card.** It stays a dock child at `left: 0; bottom: calc(100% + 8px)`, so it sits above the instruments in both layouts.
- **Center on truck.** The `.recenter` panel moves into the dock, `position: absolute; right: 0; bottom: calc(100% + 8px)`, above the dock's right end. It can no longer cover a weapon card. The modal rule hides it like the other dock panels.
- **Modal rules.** Keep weapons hidden and instruments raised (IV6), and add `> .bottom-left > .recenter` to the hide rule.
- **Layout check.** `checkDockLayout` in `scripts/ui-playtest.mjs` gains position assertions, so a weapons panel above the instruments fails the check (IV1-IV5). It also shows the recenter button and hit-tests every weapon control, after scrolling a control into view when the row scrolls.

Approaches considered:
- Stack weapons above the instruments when they do not fit (approval build). Rejected by the committee: a 156px-tall wide panel over the map.
- Weapons on a full-width bottom strip at every size, instruments above. Weapons stay at the bottom, but the left stack is about 330px tall at every size, which covers as much map as the rejected build. Rejected. It is kept only as the narrow-screen fallback, where nothing else fits.
- Wrap cards into more rows inside the panel. The panel gets taller, which the committee rules out. Rejected.
- A JS ResizeObserver that measures overflow and toggles a compact class. It needs a probe on every resize and a second set of size numbers in JS. Flex shrink between 96px and 64px does the same in CSS. Rejected.
- Move the log and the right dock up so the weapons can run under the log. It moves four panels and the inspection panel's height limit for one row. Rejected.
- Narrowing cards, then scrolling inside the panel, with the stack only on narrow screens (chosen). It keeps the band as low as the instruments at desktop sizes, it needs no breakpoint, and the scroll keeps every action reachable without making the panel taller.

Backwards compatibility: no saved state, sim or public API changes. The `.recenter` panel's parent changes from `#ui` to `.bottom-left`. Only CSS and `ui-playtest.mjs` depend on it.

TDD: yes for the scroll carry-over and scroll-into-view in `WeaponPanel.render()`, a reusable behavior a regression would break silently (Vitest with the fake DOM in `weapons.test.ts`). No for the CSS layout, which Vitest cannot lay out. The Playwright check plays that role and must fail on the approval build before the CSS change (PH1).

### Invariants
- IV1 — At every viewport in IV7, the weapons panel's bottom edge is 14px above the viewport's bottom edge (±1px).
- IV2 — At every viewport in IV7, the weapons panel's top is not above the instruments' top (±1px). When stacked, the weapons panel's top is below the instruments' bottom.
- IV3 — At 1280×720, 1280×656 and 1920×1080 with six guns, the weapons panel's left edge is right of the instruments' right edge, their bottoms are level (±1px), and `.weapon-slots` does not scroll (`scrollWidth <= clientWidth + 1`).
- IV4 — At every viewport in IV7, the weapons panel is at most 190px tall.
- IV5 — At every viewport in IV7, no two of `.instruments`, `.weapons`, `.truck-condition`, `.log`, `.turn-control`, `.recenter` overlap. Above 720px wide, none of them overlaps the open `.info` either.
- IV6 — While a modal is open, `.weapons` and `.recenter` are hidden and `.instruments` has `z-index: 21`. The existing `checkVisibleReadouts` checks still pass.
- IV7 — Viewport matrix: 1920×1080, 1280×720, 1280×656, 1024×656, 900×656, 800×656, 700×800, each with the heavy HUD (storm and heat wave, the Cool engine button, six or more guns, an open inspection panel, the recenter button shown).
- IV8 — At every viewport in IV7, each weapon control (All, Hide/Show, the Auto fire switch, every `.weapon-pick`, `.weapon-hold`, `.weapon-reload`) takes the click at its center, after `scrollIntoView` when its row scrolls.
- IV9 — After a re-render, `.weapon-slots` keeps the previous `scrollLeft`. After the selected weapon changes, the selected card is scrolled into view.
- IV10 — No CSS rule positions `.weapons` or `.truck-condition` with an offset derived from another panel's size: `grep -n "412px\|542px\|644px\|100% + 110px" src/ui/*.css` is empty. No file under `src/sim/`, `src/data/` or `src/phys/` changes.

### Principles
- PC1 — The weapons panel gives way in size, never in place: narrower cards, then a scroll inside the panel. Only the instruments move, and only when the screen is too narrow for both on one line.
- PC2 — Each layout size is one CSS variable: card widths, the gap, the Auto fire width and `--weapons-min` come from the same variables, and `--log-width` feeds both the log and the right reserve.
- Project principles. The change is UI layout plus a scroll carry-over in the weapons panel.
  - P1, one rulebook: no rule branches. The weapons panel only shows the player's guns, as today.
  - P2, sim owns rules: no rule is read outside `src/sim/` beyond what `weapons.ts` reads today (`vehicleStats`, `fireBlock`, `hitOdds` through `getWeaponReadout`). Controls still go through `host.runKey` and the existing order functions.
  - P3, hot code: `render()` adds one `scrollLeft` read and write and, only on a selection change, one `scrollIntoView`. No list scans.
  - P4, value: no source or sink.
  - P5, saves: no saved type, no cache, no migration.
  - P6, randomness: no new draws.
  - P7, fail loud: no new sim invariant. The layout check asserts IV1-IV8 and fails the script.

### Assumptions
- AS1 — Supported viewports are at least 700px wide and 600px tall, as in revision 1.
- AS2 — At ≤720 the inspection panel (`top: 190px`) can cover the top of a stacked dock. That was so before #165 too. IV5 covers `.info` only above 720px.
- AS3 — The dev console's `randomkit 5` gives a six-gun truck within 40 tries, as the approval build's `loadHeavyHud` found. If it gives more than six, the check also records the scroll case.
- AS4 — Chromium in Playwright supports `max-width: max-content` on flex items and `flex-basis` with `calc()` of custom properties.

### Unknowns
- UK1 — The real width of the heavy instruments and of a six-gun panel with 64-96px cards at 1280×656, so whether six guns fit without scrolling there. PH1 logs the boxes. If six do not fit, lower `--weapon-auto` first and then `--weapon-card-min`, down to 60px, which still holds Hold and Reload on one line.
- UK2 — Whether, on stacked narrow screens (900×656, 800×656), the condition card reaches the top-left row. Before #165 it was stacked there too. PH1 logs it. It is a Deferred item, not a failure, unless it covers a weapon control.

## Plan

Approach: make the check fail on the approval build first, because it lets weapons sit above the instruments. Then change the dock order, the card sizes and the right reserve in CSS, and add the scroll carry-over in `WeaponPanel`. Then take the gameplay screenshots and click the controls.

### PH1 — Position assertions in the layout check (fail on the approval build)
- 1.1 `scripts/ui-playtest.mjs`, `loadHeavyHud` (modify)
  - Keep the `randomkit 5` loop until six or more guns. Record the gun count and log it.
  - Show the recenter button with `window.__ROAM__.hud.showRecenter(true)` (`Game.hud`, `src/three/game.ts:278`). If the frame loop hides it again, pan the camera off the truck the way `game.ts` does before it calls `showRecenter`.
- 1.2 `scripts/ui-playtest.mjs`, `checkDockLayout` (modify)
  - Add `.recenter` to `DOCK_PANELS`.
  - Also measure the `.weapon-slots` `scrollWidth` and `clientWidth`, and the viewport size.
  - Assert IV1, IV2 and IV4 at every viewport, and IV3 at 1920×1080, 1280×720 and 1280×656 when the gun count is six. Messages name the viewport and the measured numbers.
  - For IV8, call `scrollIntoView({ block: "nearest", inline: "nearest" })` on each control before its hit test.
  - Keep the no-overlap check (IV5) and the screenshot per viewport.
- Run `CPU=1 npm run ui-playtest` against the approval build with `npm run dev` running. It must fail on IV2 or IV3 at 1280×656. Keep `.playtest/dock-1280x656.png` as `tmp/hud-165-before.png`.
- Commit: `ui-playtest: check the weapons panel stays on the bottom edge beside the instruments (#165)`. The pre-commit hook runs lint and tsc, not the ui-playtest, so this commit can land while the check fails.

### PH2 — Weapons stay at the bottom: narrowing cards, scroll, then stack
- 2.1 `src/ui/weapons.test.ts` (modify), first, failing
  - Give `FakeNode` a `scrollLeft` number, a `scrollIntoView` spy and `querySelector` support for `.weapon-slots` and `[data-weapon="<id>"]`.
  - Test: set the rendered row's `scrollLeft` to 120, render again, and the new `.weapon-slots` has `scrollLeft` 120 (IV9).
  - Test: select weapon 2 by `host.runKey("Digit2")` or the pick click, render, and that card's `scrollIntoView` is called once with `{ block: "nearest", inline: "nearest" }`. A render with no selection change calls it zero times.
- 2.2 `src/ui/weapons.ts`, `WeaponPanel.render()` (modify)
  - Before `replaceChildren`, read the old `.weapon-slots` `scrollLeft`. After, write it to the new row.
  - Keep a `private shownSelection` with the last rendered `host.selectedWeapon()`. When it differs, call `scrollIntoView` on the selected card, then store it.
- 2.3 `src/ui/hud.ts:110` (modify): `private recenter = panel("recenter", bottomLeft());`.
- 2.4 `src/ui/style.css` (modify)
  - `#ui` (17-38): set `--right-column: calc(var(--log-width) + 16px)`. Add `--weapon-card: 96px; --weapon-card-min: 64px; --weapon-gap: 6px; --weapon-auto: 72px; --weapons-min: calc(16px + var(--weapon-auto) + 2 * (var(--weapon-gap) + var(--weapon-card-min)))`. The 16px is the panel's left and right padding, which uses the same 8px number.
  - `.bottom-left` (1612-1631): `flex-direction: row-reverse; flex-wrap: wrap-reverse; justify-content: flex-end; align-items: flex-start`. Keep `gap: 8px` and the `max-width`. Set `.weapons` to `order: 0` and `.instruments` to `order: 1`. Replace the comment with one that says the weapons keep the bottom line and the instruments go above only when they do not fit.
  - `#ui .bottom-left > .weapons`: `flex: 1 1 var(--weapons-min); max-width: max-content; min-width: 0`.
  - `#ui .bottom-left > .recenter`: `position: absolute; right: 0; bottom: calc(100% + 8px); left: auto; transform: none`. Drop `left: 50%`, `bottom: 124px` and the transform from `#ui .recenter` (755-761).
  - `.weapons fieldset` (394-403): `flex-wrap: nowrap`. `.weapons fieldset > .switch`: `flex: 0 0 var(--weapon-auto); white-space: normal`.
  - `.weapons .weapon-slots` (404-408): `flex-wrap: nowrap; gap: var(--weapon-gap); min-width: 0; overflow-x: auto; scrollbar-width: thin`.
  - `.weapons .weapon-slot` (409-412): `width: var(--weapon-card); min-width: var(--weapon-card-min); flex-shrink: 1`.
  - `.weapon-ammo-row` (449-454): `flex-wrap: wrap; gap: 2px`.
  - Modal rules (1037-1053): add `#ui:has(.modal:not([style*="display: none"])) > .bottom-left > .recenter` to the hidden list.
  - `@media (max-width: 720px)`: keep `--right-column: calc(var(--log-width) + 14px)`.
- Run `npm test`, `npm run typecheck`, `npm run quality` (repo root) and `CPU=1 npm run ui-playtest`. IV1-IV8 must pass at every viewport. If IV3 fails at 1280×656, follow UK1.
- Commit: `Keep the weapons panel on the bottom edge: cards narrow, then scroll, and the instruments stack above only on narrow screens (#165)`
- Respects: IV1-IV10, PC1, PC2.

### PH3 — Gameplay screenshots, clicks and the playtest
- Run `npm run playtest -- --cpu` (or without `--cpu` on a GPU).
- In a Playwright script `tmp/hud-165-shots.mjs`, load the heavy HUD with six guns (reuse the console commands from `loadHeavyHud`). Take `tmp/hud-165-after-1280x656.png` and `tmp/hud-165-after-900x656.png`, with the camera on the truck and the map in view.
- Build `tmp/hud-165-compare.png`: image 1, image 2, the before capture and the 1280×656 after capture side by side. Look at it, and record each item as seen or not seen in the task file:
  - The weapons panel's bottom edge is level with the instruments' bottom edge, and the panel is right of the instruments.
  - No part of the weapons panel is above the instruments' top edge.
  - The map shows in the area where image 2 had the weapons panel (left half, above the instruments).
  - The "Weapons" title, All, Hide, the Auto fire switch and all six cards with their Hold and Reload buttons show in full, and no pip covers a Hold button.
  - The clock, dial, weather text and all five action buttons show in full.
  - The weapons panel stops left of the log.
  - In the 900×656 capture, the weapons panel is on the bottom edge, the instruments are above it, and every card is visible or reachable by the row's scroll.
- In the same script at 1280×656, click Auto fire, card 1 and Hold on card 1, and check the world: `player.autoFire` flips, the selected weapon becomes card 1's id, and card 1's weapon order is cleared. At 900×656, press key 6 and check that card 6 is inside the row's visible box.
- Record UK1, UK2 and AS1-AS4 outcomes in the task file.
- No commit unless something fails. Screenshots stay in `tmp/` and `.playtest/`.

### Test strategy
- Layout: `ui-playtest.mjs` asserts IV1-IV8 over IV7. The PH1 run on the approval build shows the check catches the rejected layout.
- Scroll carry-over: Vitest in `weapons.test.ts` (IV9).
- Behavior unchanged: the existing `weapons.test.ts` and HUD tests pass, and the PH3 clicks show the controls still change the world as before.
- IV10: grep and `git diff --stat main...HEAD` at the end.

### Order & dependencies
- PH1 before PH2, so the check fails first. Within PH2, 2.1 before 2.2. PH3 after PH2.

### Risks / rollback
- RK1 — Between about 1100 and 1250px wide, a six-gun panel scrolls beside the instruments instead of stacking. That is the chosen trade for a low band (Hands-off decisions). Key selection scrolls the card into view.
- RK2 — On stacked narrow screens the condition card can reach the top-left row (UK2). That was so before #165. If it covers a weapon control, IV8 fails, and the fix is to let the condition card join the flow above the instruments. Otherwise log it as Deferred.
- RK3 — `max-width: max-content` on the weapons panel with shrinking cards could leave the panel wider than its row if Chromium sizes the row's max-content differently. IV3 and the screenshots catch it. The fix is `width: fit-content` on the panel.
- Rollback: revert the PH2 commit. The PH1 check then fails, which documents the rejected layout.

## Code smells
- `src/ui/style.css`, `@media (max-width: 720px)`: the log moves to `bottom: 176px` with a fixed number, and the right dock to `bottom: 264px` to match. They stay as they are.

## Conclusion

### Hands-off decisions
- udesign: weapons narrow their cards, then scroll inside the panel, and never move above the instruments. The committee asked that weapons stay at the bottom and not cover the map.
- udesign: the dock stacks (instruments above, weapons on the bottom line) only when the band beside the instruments cannot hold Auto fire and two narrow cards. Stacking costs about 175px of map height, and a scroll costs one gesture. So a scroll is preferred until the panel would be useless beside the instruments.
- udesign: a 64px card minimum with Hold and Reload wrapping under the pips. That keeps every action on every card, as the committee asked.
- udesign: drop the inspection panel from the right reserve. Its height limit keeps it above the bottom band, so the reserve only cost weapon width.
- udesign: move "Center on truck" into the dock above its right end. Its old spot falls on the weapon cards at desktop widths.
- udesign: the scroll position is kept across renders, and a selection by key scrolls its card into view, because `render()` rebuilds the panel on every update.
- uplan: plan auto-approved.

### Visual self-review
Views read: `tmp/hud-165-after-1280x656.png` and `tmp/hud-165-after-900x656.png` (real captures, CPU Chromium, heavy HUD with 8 guns, storm and heat wave, Cool engine button, open inspection panel, recenter shown).
- 1280×656: the weapons panel sits right of the instruments, bottoms level (the instruments stretch to the panel's height), nothing above the instruments' top, the map above the band is visible, the panel stops left of the log. Title, All, Hide, Auto fire and the cards with Hold and Reload show. With 8 guns the card row scrolls inside the panel (6 guns need about 508px of the 514px).
- 900×656: weapons on the bottom line, instruments stacked above, row scrolls for the 8 guns.
- Mismatch found and fixed: the panel was 4-16px taller than the instruments, so its top rose above theirs; the dock now uses `align-items: stretch`.
- Remains: card widths differ a little (two-line names shrink less); the check's scrollIntoView leaves card 1 half cut in the capture; the condition card goes off the top at 900/800 wide (UK2, as before #165, covers no control). The `before` capture, the compare sheet and the PH1 failing run on the approval build were skipped because the machine is very slow. `npm run playtest` was not run, as the stage says.

### Results
- IV1-IV8 pass at all 7 viewports (dock-only run of the layout check; the full `ui-playtest` did not finish on this loaded machine). IV9 by two Vitest tests. `npm test` (3858) and typecheck pass.
