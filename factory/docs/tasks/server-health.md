# Server health: work clone cleanup, disk guard and Hermes health alerts

## Context
- On 2026-10-03 the disk filled up around 02:00. Jobs and the dev build died, one left a lock behind, and the factory made no progress until 10:25. Hermes saw failed jobs but no cause, because nothing reports disk space or a stalled tick.
- The only cleanup in the tick is `cleanBuilds` in `src/tick.ts`. It removes web root builds and nothing else. `factory-update.sh` prunes old release folders. Nothing else is cleaned.
- Work clones under `$FACTORY_HOME/work` are never cleaned except by `approve`, in `src/stages/approval.ts`. Six other ends of an issue keep their clone: deny, triage and design "won't do", bundle, hotfix, ship and a close by hand. `change-*`, `adhoc-*`, `dev-build`, `release-main` and `check-issue-*` are removed only before the next use of the same name.
- Each clone holds about 270 MB of `node_modules`. With 25 open cards this is about 7 GB, and it grows with the backlog. The cleanup on 2026-10-03 freed 9.6 GB without losing any work.
- Job logs in `$FACTORY_HOME/logs` grow by about 130 MB a day and are never removed.
- Hermes's incident watch in `hermes/factory-incidents.sh` lists only stuck issues, failed jobs, tick crashes, dev build failures and update failures.

## Desired design
- Every tick runs a work sweep after `cleanBuilds`. It deletes each clone whose owner is finished, and `node_modules` in each idle clone. An issue clone stays while its issue has an open card outside Done, so its task file and commits stay.
- Every tick, paused or not, writes `$FACTORY_HOME/health` with the time and the free disk space. When free space is under `FACTORY_MIN_FREE_GB`, the tick starts no new job and logs why. Running jobs go on.
- The incident watch adds three health lines: low disk, a stalled tick and a pause that stayed over an hour. Each line keeps the same text while the problem lasts, so it wakes Hermes once.
- `SOUL.md` gets a "Server health" section. It says what each line means, what Hermes may delete without asking, how to clear a stalled tick, and when to escalate.
- Out of scope: the root cause of the orphaned lock. Hermes's job `factory-stall-recovery-plan` covers it. The stalled-tick line makes the next one visible within 20 minutes.

## Invariants and principles
- Never delete progress. An open issue keeps its clone with `.factory-tasks/`, `.factory/` and its commits. Sessions, state, `recovery/` and `release-candidate` while a release is open stay. Test: the sweep keeps `issue-N` for a card in Triage to Approval.
- Never delete under a running job. The sweep skips the clone of every job in `jobs` and every issue in `interrupted`, since a resumed job continues in its clone. Test: a running testing job keeps `issue-N` and `check-issue-N`.
- The sweep deletes only known folder names. An unknown folder stays and is logged once per tick.
- Hand-run steps run only while paused, as `SOUL.md` already says. The sweep runs inside the tick, so it never runs while a hand step works.
- Every stage that runs code reinstalls `node_modules`. `implement.md`, the check script, `deploy.ts`, `candidate.ts` and `ship.ts` run `npm ci` already, and an ad hoc clone starts fresh. `test.md`, `test-fix.md` and `review.md` get an `npm ci` line.
- Each threshold is a setting in `settings.env` with its reason in the comment.

## Implementation plan
### Phase 1: work sweep and log retention
- New `src/cleanup.ts` with `cleanWork(ctx, cards)` and `cleanLogs(ctx)`. They follow the `removeStaleBuilds` pattern in `src/deploy.ts`.
- Keep rules:
  - `issue-N` stays while a job runs on N, N is in `interrupted`, or N has a card outside Done whose issue is open.
  - `check-issue-N` stays while a testing job runs on N.
  - `change-<id>` stays while its change job runs or it is in `pendingChanges`.
  - `adhoc-N` stays while its ad hoc job runs or N is in `interrupted`.
  - `dev-build` stays while a dev job runs.
  - `release-main` stays while a ship job runs.
  - `release-candidate` stays while `state.release` is not null.
  - `land` belongs to `repo.ts` and is never touched.
- A clone that stays but has no running job loses its `node_modules`, `game/node_modules`, `factory/node_modules` and `quality/node_modules`.
- `cleanLogs` deletes logs older than `FACTORY_LOG_DAYS` except `tick.log` and `update.log`, and except logs that `failures` names.
- `Card` stays as it is. Every factory path that closes an issue moves its card to Done, and the closed issues on the board are all in Done.
- `incident-N` clones of `src/stages/incident.ts` stay while the incident is queued. With no card on the board at all, every issue clone stays, since an empty board read is doubtful.
- `test.md`, `test-fix.md` and `review.md` run tests without installing, so each one gets an `npm ci` line.
- `tick()` in `src/tick.ts` calls both after `cleanBuilds`.
- `settings.env` gets `FACTORY_LOG_DAYS=14`. Failures live a day, and a release spans 7 days, so 14 days covers two releases of history. `src/config.ts` reads it.
### Phase 2: disk guard and health file
- New `src/health.ts`. `writeHealth(home)` writes `{"at": <iso>, "freeGb": <n>, "minFreeGb": <n>}` to `$FACTORY_HOME/health` with `statfsSync`. It writes a temp file and renames it.
- `src/cli.ts` calls `writeHealth` on every tick, before the pause check. A paused tick still reports.
- `tick()` returns before `chooseJobs` when free space is under the minimum. It logs `disk low: <n> GB free, starts nothing`.
- `settings.env` gets `FACTORY_MIN_FREE_GB=5`. A tick starts at most 5 jobs. Each needs about 0.6 GB for a clone, `node_modules` and a build, and an image rebuild needs room too.
### Phase 3: Hermes health lines and instructions
- `hermes/factory-incidents.sh` prints these lines:
  - `disk low: under <min> GB free`, when `health` says so.
  - `tick stalled: no tick since <at>`, when `health` is older than 20 minutes. A tick waits up to 15 minutes on the repo lock, `REPO_LOCK_MS` in `src/repo.ts`, and the timer runs every minute.
  - `paused over an hour: <reason>`, when `paused` is older than 60 minutes.
- `hermes/SOUL.md`, new section "Server health":
  - Disk low: pause, wait until `jobs` is empty, then delete without asking. Hermes may delete the folders the sweep would delete, `node_modules` in idle clones, logs older than `FACTORY_LOG_DAYS`, dangling Docker images and Docker build cache. Never delete an open issue's clone, `sessions/`, state, `recovery/`, `committee/` or `release-candidate` while a release is open. Escalate when free space stays under the minimum after cleanup.
  - Tick stalled: find the tick process and the lock it waits on in `/factory/home/locks` and `state.lock`. Remove a lock only when its owner pid is dead or has hung longer than its timeout. Report what held it on the incident.
  - Paused too long: finish or remove its own pause. It asks the committee about a pause someone else set and never removes one.
  - Each line covers the general rule: fix, then go [SILENT], and escalate after a second failure.
- `README.md` documents the sweep, the guard and the health file.

## Verification
- `npx vitest run src/cleanup.test.ts src/health.test.ts src/tick.test.ts src/config.test.ts` passes. It covers each keep rule, the running and interrupted skip, the unknown folder, the node_modules strip, log retention with a failure log kept, and the guard starting no job under the minimum.
- `uv run --with pytest --with pyyaml pytest hermes` passes, with new cases that run `factory-incidents.sh` on a temp home: health fresh and full, disk low, stale health, old pause.
- `npm run typecheck` and `npm run quality` pass.
- Manual try, positive: on a copy of the server's `work/` listing as empty folders, run `cleanWork` with the current board. Open issues keep their clones, closed issues and merged changes are deleted.
- Manual try, negative: a running testing job on an issue that also appears closed keeps both of its clones, and a folder named `scratch` stays and is logged.

## Result
- Done. The tick sweeps work clones and job logs, writes `$FACTORY_HOME/health` and starts no job under `FACTORY_MIN_FREE_GB`. The incident watch reports low disk, a stalled tick and a pause over an hour. `SOUL.md` tells Hermes how to handle each one and what it may delete without asking.
- `npx vitest run src/cleanup.test.ts src/health.test.ts src/tick.test.ts src/config.test.ts`: 72 passed. `npx tsc --noEmit`: clean. `npm run quality`: passed. `uv run --with pytest --with pyyaml pytest hermes`: 111 passed.
- Manual try, positive: the sweep ran on empty copies of the server's 47 work folders, with the server state and the live board of 2026-10-03. All 35 open cards kept their clones and lost only their packages. The four running jobs and the interrupted #81 kept everything. `check-issue-131`, `release-candidate` and the clone of the open change PR were removed. Their content is on GitHub or in the web root.
- Manual try, negative: a folder named `scratch` stayed and was reported. The empty-board and running-job cases are covered by tests.
- Not verified on the server yet. It deploys with the merge into `main`.
