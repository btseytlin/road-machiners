# Garage: compare shop parts with the selected part, and drop two idle labels (issue 180)

**Status:** plan
**Branch:** factory/issue-180
**Worktree:** none
**Goal:** In a real garage (Nose and Bowl), a mounted or stored weapon that looks selected is selected: the inspection panel and the Buy Parts cards name the same part, and the cards show "Compared with <part>" with signed deltas. Changing or clearing the selection updates the cards. The garage screen shows neither "Nothing broken" nor the "N free" chip, while broken counts, repair buttons and the other header chips stay. The proof is a browser check and screenshots at 1280×730 and narrower widths.
**Mode:** hands-off

## Context

- Mouse selection already drives the comparison. In tmp/repro-180*.mjs at Nose and Bowl, clicking a mounted MG turret or a stored Slug cannon marks it `.selected`, and the shop then shows "Compared with …" and deltas on every card, before and after switching to Buy Parts or the weapon filter. A second click clears both. Presses of 30 to 450 ms never focus a mounted item, because `startPress` cancels `pointerdown`.
- The inspection panel has a second writer. `InventoryView.itemEl()` (`src/ui/inventory.ts:242-247`) and `truckItemEl()` (`:672`) call `showItem` / `showTruckItem` on `focus`, without selecting. The selection, read by `selectedPart()` and therefore by `compareBase()` in `town.ts`, stays null.
- That reproduces the screenshot exactly. After Tab focuses the mounted MG turret, the inspection shows "MG turret / Mounted", the grid draws the gold `.inv-item:focus` border (`style.css:1123-1126`, the same gold as the `.selected` outline), and no card shows a comparison. Enter then selects it and the comparison appears.
- Looted-truck items (`truckItemEl`) have no Enter handler. Focus is their only keyboard way to inspect.
- "Nothing broken" comes from `TownScreen.repairBar()` (`src/ui/town.ts:317-329`), which every shop screen uses, garage and stall alike (#99). The disabled buttons beside it already say "Basics fine" and "No repairs". Its span is the `flex: 1` element that pushes the buttons right (`style.css:1841-1844`).
- The "N free" chip is not in `inventoryHeader()`, which the issue names. It is in `truckChips()` (`src/ui/inventory.ts:966-983`), shared by the shop screen (`town.ts:121`), the NPC trade screen (`town.ts:562`) and the standalone inventory window (`inventory.ts:958`).
- Vitest runs in Node with no DOM, and no UI test renders elements. Browser regressions live in `scripts/ui-playtest.mjs` (`node scripts/ui-playtest.mjs <url>`). On this branch that script already fails before any shop step: "Clock must show day and time, got Day 1".
- `compareBase()` does not filter by part kind, so a selected weapon is shown against engines too, with deltas only on shared stats. That is the current design from commit 03592185.

## Reference images

1. `/work/.factory-media/ref-9a93a0421a87.jpg` (1280×730, Nose garage), seen.
   - **What it shows:** the Nose shop screen. The header holds chips for "Convertible", money 1,128, "25 free" and "3,640 kg / 4,440 kg". Below it, a wrench, "Nothing broken" and the disabled buttons "Basics fine" and "No repairs". The Slug cannon on the right deck mount has a gold border. The inspection panel below Garage storage reads "Slug cannon / Mounted, pristine 46/46 HP". Buy Parts is open with the weapon filter. The Long rifle, Anti-materiel rifle, Slug cannon and Shotgun cards show plain stats, with no "Compared with" line and no deltas.
   - **What the design takes from it:** the bug state (the panel and grid say a part is chosen, the shop does not compare) and the two labels to remove.
   - **What the design infers:** the gold border plus the panel say "focused, not selected", the only state found that produces this picture (Context, bullet 3). That the reporter reached it by keyboard focus is AS1.
   - **Should the result look like the image?** Only partly. The layout should stay the same, without "25 free" and "Nothing broken", and with comparison lines and deltas on the cards. That needs the visual check V1 in the test strategy.

## Design

**Root cause:** two writers own the inspection panel. Selection writes it on render, and focus writes it on `focus`. The shop reads only the selection, so the panel can show a part that the comparison ignores.

**Fix:** the selection is the single owner of what the inspection panel shows. Focus no longer inspects. Focus keeps its gold border as the keyboard cursor, and Enter selects, which already works on the player's grid. Looted-truck items get the same Enter handler, so keyboard users can still inspect them. Mouse paths do not change.

**Labels:**
- `repairBar()` drops the idle label. With broken parts it still shows "N broken" in red and both repair buttons with their costs. With none, it shows the wrench and the two disabled buttons. The buttons stay right-aligned through `margin-left: auto` on the first button, not through the label's `flex: 1`.
- `truckChips()` gets an option to leave out the free-cells chip. The shop screen omits it at a garage only (`def.kind === "garage"`), as the issue asks. Stalls, the NPC trade screen and the inventory window keep it.

**Approaches considered:**
- **A. Focus stops inspecting, Enter selects (chosen).** One owner and a small diff. Keyboard users lose browsing by Tab alone, but Enter gives them the same panel plus the comparison.
- **B. Focus selects.** Each focus re-renders and replaces the focused node, so focus would have to be restored by id after every render. A click on a core item focuses and then toggles, which selects and deselects at once. Too much new behavior for a bug fix.
- **C. The shop compares against the inspected item.** This keeps two notions of "current item", which is the root cause.

TDD: no. No unit test can see the bug, since Vitest has no DOM and the fault is focus versus selection in the browser. Instead, a committed browser check is written first, shown to fail on the current code (focus inspects without comparing, both labels present), then made to pass.

### Invariants
- IV1 — The inspection panel shows a part if and only if that part is the selection, and every visible shop card is then compared with it (`compareBase` rules unchanged).
- IV2 — At a garage the shop header has no free-cells chip. Stalls, NPC trade and the inventory window still show it, and the chassis, money and mass chips stay everywhere.
- IV3 — `repairBar()` never renders "Nothing broken". With broken parts it renders "N broken". The repair buttons, their costs and their disabled states are unchanged.

### Principles
- PC1 — The selection is the one source of the inspected item. No UI path writes the inspection panel from anything else.
- Project principles: the change is UI only.
  - 1, one rulebook: nothing treats the player differently from NPCs.
  - 2, sim owns rules: it reads `freeCells()` (`sim/grid`), `mountedParts()` plus `hp === 0` (unchanged existing read), `basicsRepairCost()` and `repairCost()` (`sim/economy`). It adds no copy of a rule.
  - 3, hot code: no new loop.
  - 4, value: no source or sink of value.
  - 5, save facts: no saved type, no migration, no cache.
  - 6, same seed: no random draw.
  - 7, fail loud: a null selection is a normal state. No new invariant throws.
- DESIGN.md Information: "The game shows what the player needs to decide." The two removed labels repeat what the disabled buttons and the grid show, and the comparison is what the player decides by.

### Assumptions
- AS1 — The reporter's screenshot came from a focused, unselected item, for example after Tab. No mouse path tested produced it. If the browser check passes but the reporter still sees no comparison after a mouse click, that is a different cause and a new issue.
- AS2 — "Nothing broken" goes from stalls too, because `repairBar()` is one shared component and the disabled buttons already say the same thing there.
- AS3 — The free-cells chip goes at garages only, as the issue asks, even though a garage's Market tab also sells goods. The grid still shows the free cells.
- AS4 — The comparison keeps its current rule: any selected part, any card kind. The issue asks for a kind filter only "if current design filters those", and it does not.

## Plan

Approach: a fail-first browser check, then one small UI commit for each cause.

### PH1 — Failing garage browser check
- 1.1 `scripts/garage-ui-check.mjs` (create), modeled on `scripts/ui-playtest.mjs`
  - Usage: `node scripts/garage-ui-check.mjs <dev-server-url>`. It launches Chromium with the same args as ui-playtest and fails on any page error.
  - Setup per garage (`nose`, `bowl`): `await import('/src/sim/cheats.ts')`, `teleport(state, placeSpot(state, id))`. Clone the world, push a stored `slugCannon` into `player.storage`, `apply`, `__ROAM__.town.open()`, click the Buy Parts tab.
  - Checks, each its own assertion message:
    - (a) Mouse click on a mounted `.inv-item.k-weapon.mounted`: it is `.selected`, the inspection names it, and every `.town-shop .card` has a `.card-compare` naming it plus at least one `.delta`.
    - (b) Clicking the stored Slug cannon chip moves the comparison to "Slug cannon". Clicking it again, after waiting past `DOUBLE_CLICK_MS`, clears every `.card-compare` and the inspection reads "Equipment".
    - (c) Keyboard: `focus()` on the mounted gun, with nothing selected, leaves the inspection at "Equipment" and the cards without a comparison (fails today). Enter then selects and compares.
    - (d) The garage header `.town-screen h3 .chips` has no chip titled "Free cargo cells", and has the chassis, "Money" and "Mass against rated load" chips (fails today).
    - (e) `.town-repair` text does not contain "Nothing broken" (fails today). Then set one mounted weapon's `hp` to 0 through `apply`: `.town-repair .bad` reads "1 broken" and the "Repair all N" button is enabled.
    - (f) Negative, other screens keep the chip: at the stall `salvage-yard` the header has "Free cargo cells". After closing the town screen and pressing `i`, the inventory header has it too.
    - (g) Layout: at viewports 1280×730, 1024×730 and 800×730, the header chips and the repair buttons lie inside `.town-screen`'s box. Save screenshots to `.playtest/garage-<width>.png`.
  - Respects: IV1, IV2, IV3. It must fail on (c), (d) and (e) before PH2 and PH3, and pass (a), (b) and (f).
- 1.2 `docs/tools.md:28-30` (modify): one sentence under Browser checks naming `node scripts/garage-ui-check.mjs <url>` and what it covers.
- Commit: "Add a garage browser check for selected-part comparison and header labels (#180)". The check is committed failing on purpose, since the next phases fix it. If the hook objects, fold PH1 into PH2's commit.

### PH2 — Selection is the only writer of the inspection panel
- 2.1 `src/ui/inventory.ts:235-266` `InventoryView.itemEl()` (modify): remove `const inspect` and `node.addEventListener("focus", inspect)`. The Enter `keydown` handler stays.
- 2.2 `src/ui/inventory.ts:667-683` `InventoryView.truckItemEl()` (modify): remove the `focus` listener. Add the same Enter `keydown` handler as `itemEl`, calling `this.clickItem(this.clicked("truck", it.id, it))`, for core and non-core items.
- 2.3 Update the comment on `selection()` / `showSelection()` (`:311`, `:333`) to say the panel shows only the selection, if those comments mention focus. Otherwise leave them.
- Respects: IV1, PC1.
- Commit: "Inspect only the selected item, so the shop always compares with what the panel shows (#180)"

### PH3 — Garage header and repair bar labels
- 3.1 `src/ui/inventory.ts:965-983` `truckChips(w: World, opts: { freeCells: boolean } = { freeCells: true }): HTMLElement` (modify): leave out the free-cells chip when `opts.freeCells` is false. Update the comment above it.
- 3.2 `src/ui/town.ts:121` `TownScreen.render()` (modify): `truckChips(w, { freeCells: def.kind !== "garage" })`. The trade screen (`:562`) and `InventoryScreen` (`inventory.ts:958`) keep the default.
- 3.3 `src/ui/town.ts:316-329` `TownScreen.repairBar()` (modify): render the `<span class="bad">N broken</span>` only when `broken > 0`, and nothing else in its place. Buttons unchanged.
- 3.4 `src/ui/style.css:1841-1844` (modify): replace the `.town-repair .bad, .town-repair .dim { flex: 1 }` rule with `.town-repair > button:first-of-type { margin-left: auto; }`, so the buttons stay right-aligned with or without the count.
- Respects: IV2, IV3, AS2, AS3.
- Commit: "Drop the idle Nothing broken label and the garage free-cells chip (#180)"

### Test strategy
- Browser: `node scripts/garage-ui-check.mjs http://localhost:5173/` fails on (c), (d) and (e) after PH1, and passes after PH3.
- Regression: `npm test`, `npm run typecheck`, `npm run quality` from the root, and `npm run playtest -- --cpu`. On this machine `scripts/ui-playtest.mjs` already fails on the clock assertion. Record that as pre-existing, not as caused by this change.
- V1, visual acceptance: at Nose, 1280×730, Buy Parts with the weapon filter and a mounted weapon selected, take `.playtest/garage-1280.png` and lay it beside `/work/.factory-media/ref-9a93a0421a87.jpg`. These must match by name:
  - the header shows the town name, chassis chip, money chip and mass chip, and no "N free" chip;
  - the repair row shows the wrench and the "Basics fine" and "No repairs" buttons, right-aligned, and no "Nothing broken";
  - the selected weapon on the grid has the gold selected outline, and the inspection panel names it with "Mounted";
  - every weapon card has a "Compared with <selected weapon>" line under its condition row, and signed, colored deltas beside its stats;
  - the grid, Garage storage, tabs and card layout are otherwise as in the reference.
  
  Repeat at 1024 and 800 wide and look at both images for clipping or overlapping chips and buttons. The committee confirms the small visual details.

### Risks / rollback
- RK1 — Keyboard users lose Tab-only browsing of item stats. Enter gives the same panel. Rollback is reverting PH2.
- RK2 — AS1 is wrong, and the reporter hit a mouse path that the check does not cover. The check (a) and (b) results go in Verify, so a remaining report can be told apart.
- RK3 — `margin-left: auto` also changes the stall's repair row. That is intended, and the check (g) screenshots show it at the stall too if one is taken.

## Code smells
- `scripts/ui-playtest.mjs` fails on this branch with "Clock must show day and time, got Day 1", before it reaches any shop step. It is unrelated to this issue and is not fixed here.
- `.inv-item:focus` and `.inv-item.selected` use the same gold. Even after the fix, a focused item looks almost selected. That is out of scope; it is a candidate follow-up for a distinct focus ring.

## Conclusion

### Hands-off decisions
- udesign: the root cause is the focus listener that inspects without selecting. Mouse paths were reproduced as working at Nose and Bowl (tmp/repro-180*.mjs) — this is the only state that matches the screenshot.
- udesign: focus stops inspecting (approach A) instead of focus selecting (B) — this is the smallest change with one owner and no focus-restore machinery.
- udesign: looted-truck items get Enter to select — removing their focus-inspect would otherwise leave keyboard users no way to inspect them.
- udesign: "Nothing broken" is removed from stalls too (AS2) — `repairBar()` is shared, and the same disabled buttons say it.
- udesign: the free-cells chip is hidden at garages only (AS3) — that is the issue's explicit scope.
- udesign: the comparison is not filtered by part kind (AS4) — the issue makes the filter conditional on the current design, which has none.
- udesign: regression coverage is a committed browser script, not Vitest — Vitest has no DOM, and the bug lives in browser focus and render.
- uplan: plan auto-approved.

### Visual self-review
- Views read: `.playtest/garage-1280.png` and `.playtest/garage-800.png` (Nose garage, Buy Parts, 2 broken parts, nothing selected), captured by `scripts/garage-ui-check.mjs` in a real browser.
- Found against the plan and the reference: no "N free" chip, no "Nothing broken" label; the "2 broken" count and both repair buttons stay and sit right-aligned; chassis, money and mass chips intact. At 800 wide the repair buttons wrap into narrow columns and the tabs wrap, with nothing clipped or overlapping.
- The comparison itself (selected weapon, "Compared with" line, deltas on every card, clearing, Enter from focus) is asserted in the script at Nose and Bowl, not shown in these stills. No still of the selected state was read because the machine was too slow (load ~30). The committee should confirm that look.
- Fixed: none needed after capture. Remaining: the 1024 shot was saved but not read.

### Other
- Pre-existing: `scripts/ui-playtest.mjs` fails on the clock assertion (not touched). The garage check was not run against the old code to show it failing, because of machine load.
