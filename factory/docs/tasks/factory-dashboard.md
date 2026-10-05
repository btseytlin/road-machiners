# Deploy the factory dashboard

## Context
- The approved game-style interface and live HTTP server are built. The first implementation used `dev`, which differs substantially from the deployed factory. Do not merge that branch into `main`.
- Current `main` already records job outcomes, costs and durations in `factory/src/ledger.ts`, has six worker queues, and deploys through versioned release folders without stopping jobs.
- The release worktree is `.worktrees/factory-dashboard-release`, based on `origin/main` at `6ade45a6`. It contains the copied dashboard files and an unfinished ledger test change. Nothing has been merged or deployed.
- The first implementation passed 330 tests and two HTTP probes. Those results do not verify the unfinished integration with current `main`.

## Desired design
Publish the approved read-only dashboard at the configured game domain's `/factory/` path. Show current jobs, next-release contents, token and cost analytics, job durations, public Telegram announcements, and host CPU, GPU, RAM and SSD readings. Keep the approved interface unchanged.

## Invariants and principles
- Reuse the existing ledger. Do not ship the separate telemetry store or replace current job lifecycle code.
- Keep six queues, resume behavior, running jobs, release-folder deployment and the Cloudflare Tunnel intact.
- Publish only selected public fields. Never serve private requests, chat, credentials, raw errors or logs. Missing measurements remain unavailable rather than zero. Resumed cumulative usage must not be added twice.
- Change only dashboard-related factory files. Do not touch the game, quality policy or unrelated work in the main checkout.
- No new design, framework, database, paid agent run, broad refactor or full infrastructure rebuild. Work sequentially without subagents.

## Implementation plan
### Phase 1 — Finish the integration with main
- First check the configured deployment connection with a bounded read-only command. Report an exact access blocker if it fails, without requesting broad permissions.
- `src/ledger.ts` remains the owner of job and agent measurements. Add token counters and session metadata to new agent records. Keep old records readable and identify missing token measurements explicitly.
- `src/dashboard/history.ts` owns the dashboard's bounded, incremental reading and aggregation of that ledger. Discard the first implementation's duplicate job-recording hooks. Record successful public-channel messages through the ledger, without capturing committee messages.
- Adapt `src/dashboard/config.ts`, `snapshot.ts` and the existing browser stage labels to the current six queues. Retain the implemented server, host sampler, assets and game-style interface.

### Phase 2 — Check and publish
- Run the focused dashboard, ledger, Telegram and deployment tests, factory typecheck, browser-script lint and the required repository quality gate. Fix only failures caused by this change.
- Commit the dashboard changes on the main-based branch. Fetch `origin/main` again and incorporate any new commits before publishing. Push a normal fast-forward update to `main`. Never force-push or merge the dev-based branch.
- Add a dashboard-only infrastructure entry point. It installs the systemd service and persistent dashboard configuration, adds the Unix socket mount and `/factory/` Caddy route, and installs the matching updater change. It must not rebuild agent images, restart Hermes, change the tunnel or stop factory jobs.
- Let the native updater obtain code from `main`. Preserve its release-folder swap. Future updates restart the dashboard after the swap and check its health. Configuration lives outside versioned release folders.
- Use existing deployment credentials, domain and public channel configuration. Resolve the public channel's username through Telegram's read-only metadata API if its configured identity is numeric. Do not request new credentials unless an actual required value is missing.

## Verification
- Local checks: ledger token extraction and resumed-usage accounting, six-queue mapping, private-data exclusion, stale-source behavior, read-only HTTP routes, host metric parsing, targeted deployment tests, typecheck and the unchanged quality gate.
- Local Chromium and disposable Caddy checks are not release gates. They failed before a useful test ran. Validate the installed Caddy configuration and public route on the target host instead. Do not claim local browser verification passed.
- Manual try, positive: verify the deployed commit, open the public dashboard and observe multiple live events with real job, usage and host readings. Confirm the homepage and existing game build routes remain unchanged.
- Manual try, negative: send a write request and request a private file through the public dashboard. Both must be rejected without private content. Check that unavailable readings are labeled rather than shown as zero.
- Finish with the `try` result, public URL, deployed commit and any specific remaining blocker. Do not call the task deployed based only on a successful push.

## Result
- The main-based dashboard integration and dashboard-only infrastructure entry point are implemented. The previous dev-based telemetry implementation was not merged.
- Local checks passed: factory typecheck, 642 tests with one skipped, 22 infra tests, JavaScript syntax check, repository quality gate and focused HTTP tests for live events, read-only routes and private-file rejection.
- The server's configured SSH endpoint timed out twice before login. Caddy could not be validated on that host and the public dashboard was not deployed.
- Submit this change as a factory-change pull request against `main`. A committee member merges it after review. The dashboard-only infrastructure command in `factory/dashboard/README.md` remains required once the host is reachable.
