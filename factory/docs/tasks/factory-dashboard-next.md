# Factory dashboard clarity and analytics

## Context
- Current `Doing` often says “Running command” because worker reports contain only broad activity categories. The live Manager record said “Waiting for model” for over 16 minutes while its heartbeat stayed fresh. That does not prove the model is stuck. The current view hides how long the phase has lasted.
- Next release and Event log show only a few items at once. Event entries show time but not date, even though the source spans 30 days. Server container rows follow sampler order rather than CPU use. Waiting and free capacity share a row despite describing different facts.
- The 24-hour range currently draws two UTC calendar-day bars. The usage chart has no model or stage split. Older cost-only ledger entries have no measured token counts, and model attribution can be incomplete.
- Work in `.worktrees/dashboard-next` on `dashboard-next`, based on `origin/main` at `3f19ae8b`. Preserve unrelated checkouts, state and `save.json`. This is a plan only until approved.

## Desired design
- Workers report predefined, privacy-safe milestones when their purpose changes. Show the current milestone in `Doing` while preserving runner-confirmed operation and progress information. Do not publish free-text status or claim model work has completed from an agent report.
- Give Next release and Event log an accessible expand button. Each opens a scrollable native dialog with the available full list, dates on events, and bounded pagination for long lists. Keep the compact panels.
- Show free queue capacity separately from waiting work and its recorded scheduling reasons. Sort server container rows by measured CPU descending. Show Manager phase duration and freshness. Diagnose the live Manager status against the actual Hermes hook lifecycle before changing reporter behavior.
- Show 24 one-hour usage buckets for the rolling 24-hour range, and daily UTC buckets for 7 and 30 days. Use a locally served Chart.js stacked bar chart for Cost or Tokens, grouped by Stage or Model through a selector. Preserve older cost-only entries in stage totals, and mark missing token or model attribution rather than assigning it to a model or displaying it as zero. Offer keyboard-accessible exact bucket data alongside the chart.
- Findings outside these dashboard behaviors are reported, not silently added to scope. Keep the page read-only and the existing homepage and `/dev/` routes intact.

## Invariants and principles
- `src/observability.ts` owns allowed milestone values and validation. The agent command and the runner convey safe structured events, `src/dashboard/live.ts` publishes only allowlisted fields, and the browser renders those fields without private task text, commands, logs or chat.
- `src/dashboard/history.ts` owns time buckets and stage/model accounting. Use reconciled ledger usage once. Never turn missing history, stale readings or incomplete model usage into a measured zero. A chart bucket must agree with its accessible values and metric total where coverage is complete.
- The dashboard remains accessible without color alone, usable at desktop and narrow widths, and compliant with its existing CSP. Bundle the chart library locally through an explicit asset allowlist. No CDN, inline styles, weakened headers, scheduling changes, new job launches or production writes.
- All changes stay in the dashboard, reporting command, agent instructions and relevant tests. Do not change private Hermes conversation content or broaden the server's read access.

## Implementation plan
### Phase 1 — Explain live work
- In `src/observability.ts`, `src/container.ts`, `docker/factory-status`, `docker/factory-agent`, and focused tests, define and accept small milestone identifiers alongside current safe activity categories. Record changes under the existing job-scoped observation lifecycle, with runner events taking precedence over agent reports and old attempts rejected.
- In `src/dashboard/live.ts` and `dashboard/dashboard.js`, project and label the current milestone and show time in the current phase. Check `hermes/plugin/observability.py` hook transitions and its tests against safe live metadata. If a missing completion hook is reproduced, fix that lifecycle there. Otherwise retain truthful “Waiting for model” with duration instead of inventing a failure.
### Phase 2 — Open details and separate capacity
- In `dashboard/index.html`, `dashboard/dashboard.js`, `dashboard/dashboard.css`, and `dashboard/browser.test.mjs`, add native dialogs for release contents and dated events. Keep list state and focus stable across live snapshots, and paginate dialog lists without rendering all history at once.
- In the same view files, separate free slots from recorded waiting decisions, label paused and stale scheduling explicitly, and sort the server's known CPU samples descending while keeping unknown measurements distinct. Add browser fixtures for many entries, changing data and keyboard dismissal.
### Phase 3 — Show hourly, stacked usage
- In `src/dashboard/history.ts` and its focused tests, aggregate reconciled usage into 24 rolling hourly buckets or UTC day buckets. Include stage and model segments for both metrics, record unallocated model cost separately, and retain history and missing-token coverage.
- Add Chart.js to `factory/package.json` and its lockfile. In `src/dashboard/server.ts`, explicitly serve its local browser bundle. In `dashboard/index.html`, `dashboard/dashboard.js`, `dashboard/dashboard.css`, and `dashboard/browser.test.mjs`, replace the handmade spend bars with a stacked Chart.js plot, Stage/Model and Cost/Tokens selectors, and a keyboard-accessible exact-value table. Keep the existing time-by-stage display unless a verified defect requires an in-scope fix.
- Update `dashboard/README.md` for milestone semantics, chart bucket boundaries and attribution coverage. Update the task file as each phase completes.

## Progress
- Phase 1: Safe milestone values travel through `factory-status`, structured runner output, job-scoped observations and the public projection. The view shows a reported milestone beside the runner operation and shows Manager phase duration. A live safe observation showed one active Hermes session with a fresh heartbeat and a long model phase. The current data does not prove a broken lifecycle, so no Hermes hook was changed. Focused checks passed: 44 tests, factory typecheck, the root quality gate and browser fixture at 1440×900, 1366×768 and 1024×768. No paid agent or production job was run.

## Verification
- Focused observation, dashboard history, snapshot, server and Hermes tests must pass. Verify hourly UTC boundaries, resumed usage, old cost-only runs, no model attribution guesses, changing and stale manager state, privacy rejection and server sorting. Run factory typecheck and the unchanged root quality gate after the last code change.
- Run the existing isolated Playwright fixture at 1440×900, 1366×768 and narrow width. Check dialogs, focus return, Escape, event dates, pagination, chart selectors, accessible values, CSP errors, private markup and unavailable readings.
- Manual try, positive: replay an active worker with successive safe milestones, a long release, old events and mixed model usage. Confirm the dialog contents, sorted server rows and hourly stacked values match the fixture.
- Manual try, negative: submit private text as a milestone and replay stale or missing manager, scheduler and token data. Confirm rejection, no public leak, no false zero or inferred cause, and no loss of keyboard access.
