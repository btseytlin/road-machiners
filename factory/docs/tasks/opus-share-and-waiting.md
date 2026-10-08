# Opus share and the waiting counter

## Context
- Triage labels `implementation-opus` on 20 of 48 recent cards, about 42%. The prompt aims for 20% Opus tokens. Opus spent $134 against $99 for Sonnet in the dashboard window, and $87 of it went to Opus implementation.
- The `hard` check fires on "spans three or more systems" or "changes shared state" alone. Most ROAM features touch the sim, the UI and saves, so most features pass it. A dust storm fade got `hard`.
- The waiting counter adds the full tick interval once for every waiting card. About 20 cards wait in the verify queue at once, so it showed 861h for one week. The number reads like clock time and is not.
- Reasoning effort stays as it is. Triage runs `low`, design `medium`, every other stage at the model default.

## Desired design
- Triage rates `hard` only for a cross-system bug with no known cause, or a change to a save format or shared data that many systems read. Spanning three or more systems alone is `intermediate`. Design still runs on Opus for those cards, and its plan carries the hard thinking.
- The waiting counter shows the average number of cards waiting over the measured time, like "4.9 cards". The tooltip keeps the summed card-hours. The stage chart keeps its bars.
- Out of scope: the verify queue capacity that causes most waiting. Its limit is memory, see `docs/tasks/queue-sizes.md`.

## Invariants and principles
- A routing label already on an issue still wins. Triage never changes labels.
- `trivial` stays as it is.
- The average counts only measured time. Gaps longer than the budget count in neither the card-time nor the measured time.
- Labels already on open issues stay. A member removes one by hand if wanted.

## Implementation plan
### Phase 1: narrower hard bar
- `prompts/triage.md`: rewrite the `hard` bullet to the two checks above. Add one line that spanning several systems alone is `intermediate`.
- `docs/stages.md` line 142: match the new `hard` definition.
### Phase 2: average cards waiting
- `src/dashboard/history.ts`: add `waitingSpanMs` to `Summary`. `addWaiting` adds each counted interval's duration to it once, whether or not cards waited. Initialize it in the empty summary.
- `dashboard/dashboard.js:324`: show `waitingMs / waitingSpanMs` as "N.N cards", tooltip with the card-hours. Rename the label in `dashboard/index.html` to "Cards waiting, average".
- `dashboard/README.md:19`: say the counter is the average number of waiting cards, and that stage bars are summed card-time.
- Tests: extend `src/dashboard/history-observability.test.ts` with two cards waiting through one interval, expecting `waitingMs` twice `waitingSpanMs`. Update the fixture in `dashboard/browser.test.mjs`.

## Verification
- `npx vitest run src/dashboard/history-observability.test.ts src/stages/triage.test.ts` passes.
- `npm run typecheck` passes, and the dashboard browser test passes.
- Manual try, positive: build a summary from `tmp/snap.json`'s ledger shape with 20 waiting cards over one hour. The counter reads "20.0 cards".
- Manual try, negative: a window with no scheduler points shows "—", not 0 or NaN.

## Result
- Done. Triage and `docs/stages.md` use the narrower `hard` bar. The dashboard shows average cards waiting, with summed card-time in the tooltip.
- `history-observability` and `triage` tests pass, 52 of 52. Typecheck passes.
- The dashboard browser test passes. It was already failing on `main`, since the funnel gained a Hardening column and the test expected six columns. The test now expects seven.
- Manual try, positive: the fixture with 1h of card-time over 30 min reads "2.0 cards", tooltip "1h 0m summed card-time".
- Manual try, negative: a snapshot with analytics unavailable reads "—".
