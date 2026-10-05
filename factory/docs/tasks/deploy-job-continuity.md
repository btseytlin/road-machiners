# Deploys never cost job progress

**Status:** done
**Branch:** deploy-job-continuity
**Worktree:** .worktrees/deploy-job-continuity
**Goal:** A factory deploy never stops or waits for a running job, and a job whose process dies restarts once with its agents' conversations intact. Confirming it needs a live deploy on the server while jobs run, and one job killed by hand that resumes.
**Mode:** interactive

## Context

- `infra/files/factory-update.sh` checks out each new `main` in place in `/opt/factory/code`, so it pauses the factory and waits until no job runs.
- PR #178 made the paused tick stop agent and test jobs after `FACTORY_UPDATE_GRACE_MINUTES`. The next tick restarts the stage from its first step. On 2026-10-02, #81's Testing started three times and never finished.
- The server deployed 12 times in the 24 hours up to 2026-10-02 23:00, mostly factory changes merged through `/change`.
- A stage rerun keeps the work clone `$FACTORY_HOME/work/issue-N`, but the agent container runs with `--rm`, so the agent's Claude Code session is lost. Testing also redoes the base merge, the agent round, the checks and the build.
- A job process died on its own once in the logs, on 2026-10-01. The kernel killed vitest inside agent containers 39 times in 3 days, at a load near 27 on 4 cores.
- The tick service runs from `/opt/factory/code/factory`. A job gets the tick's `process.cwd()` as its code dir. Hermes mounts the code folder read only at `/factory/code`, and its compose file sits in that folder.
- `readState` fills missing fields and keeps unknown ones, so code of two versions can share `state.json` while new fields are only added.
- The installed Claude Code is 2.1.287. Its sessions live in `~/.claude/projects/<cwd>/<session id>.jsonl` inside the container.

## Design

Two parts. Code folders remove deploys as a reason to stop jobs. Resume makes any other stop cheap.

### Code folders

- `/opt/factory/repo` is the git clone. Each deployed commit gets `/opt/factory/releases/<sha>`, a detached git worktree of that clone.
- `/opt/factory/code` becomes a relative symlink `releases/<sha>`. Every existing path through it keeps working.
- The server `.env` moves to `/opt/factory/factory.env`. Each release links `factory/.env` to it.
- The update script builds the next release beside the current one: worktree, `.env` link, `npm ci`, image builds and the Hermes rebuild as today. Then it swaps the link atomically and writes `deployed`. It neither pauses the factory nor waits for jobs.
- A tick resolves the link when it starts, so it and the jobs it spawns run on one release to their end. A tick that started before the swap stays on the old release.
- After each deploy the script removes every old release that no process has as its working directory, read from `/proc/*/cwd`.
- Hermes mounts `/opt/factory` read only at the same path, so the link resolves inside its container. SOUL.md names `/opt/factory/code` for the code.
- The job stopping from PR #178 goes: the grace setting, the drain in the paused tick and the container check.
- `deploy.py` migrates the live server once. It moves `/opt/factory/code` to `/opt/factory/repo`, makes the first release from `deployed`, moves `.env` and creates the link. A running job survives the move of its working folder.

### Resume

- Each issue gets a sessions folder `$FACTORY_HOME/sessions/issue-N`, mounted at the agent's `~/.claude/projects`, so agent conversations outlive their containers.
- Each agent round starts with a session id the factory picks and writes to `<round>.id` in that folder before the run.
- The tick resumes a job whose process died. It removes the job's leftover containers, marks the issue in `interrupted`, frees its cap slot and reports no failure. The next tick starts the same stage from its first step.
- In a resumed job, each agent round with a stored id continues its conversation with `claude -p --resume <id>` and a note that a stop cut it off. A round that had finished ends at once, since the agent knows it is done. `.factory/` outputs are kept, not reset.
- Merges, checks and publishing simply run again. They are safe to repeat and take minutes.
- A job resumes once. A second death means the job likely kills itself, so it fails as today and Hermes looks at it.
- A job past the timeout still fails and never resumes.
- A job's end removes the issue's sessions folder and its `interrupted` mark, success or failure. A job that starts without the mark clears any leftover sessions folder first.
- Branch jobs keep today's behavior: a dead branch job fails.

TDD: yes. The resume decision in the tick, the round session choice and the release switch logic each have clear inputs and outputs.

### Invariants

- IV1 — The update script never stops a job and never waits for one.
- IV2 — A running job's code folder exists until its process ends.
- IV3 — The link switch is atomic: every reader sees either the old release or the new one.
- IV4 — A resumed job has no container left from its dead process.
- IV5 — A job resumes at most once. The next death fails and reports to Hermes.
- IV6 — A timed-out job fails and is never resumed.
- IV7 — A job that starts without an `interrupted` mark never resumes an older session.

### Principles

- PC1 — State changes stay additive, so jobs on an old release and ticks on a new one share `state.json`.
- PC2 — Each resume logs one line with the issue, the round and the session id.

### Assumptions

- AS1 — `claude -p --resume <id>` in a new container with the same `/work/game` working folder and the mounted sessions folder continues the session.
- AS2 — An agent image rebuilt during a deploy is fine for an old job's later containers.
- AS3 — The docker CLI's death leaves the container running, so the tick must remove it.
- AS4 — The factory user can read `/proc/<pid>/cwd` of its own processes, which include every job.

### Unknowns

- UK1 — How the update script reports a release folder it cannot remove.

## Plan

Approach: two parallel phases with disjoint files, then docs. PH1 owns the server layout and removes the update pause. PH2 owns resume and the tick. The factory user cannot write `/opt/factory`, so the swapped link lives in the factory-owned `releases/`: `/opt/factory/code -> releases/current -> <sha>`, both relative. `deploy.py` makes the root-owned outer link once.

### PH1 — Code folders
- 1.1 `infra/files/factory-layout.sh` (create), run as root by `deploy.py` with the factory root as `$1`
  - Covers a fresh server and the live migration, and is idempotent. If `code` is a real folder: stop the tick timer, move `code` to `repo`, move `repo/factory/.env` to `factory.env`. Then ensure `releases/` is factory-owned, the release for `home/deployed` exists with its `.env` link and `npm ci`, `releases/current` points at it, and `code -> releases/current` exists. Start the tick timer again.
  - Respects: IV2, IV3
- 1.2 `infra/files/factory-update.sh:1-73` (rewrite), takes the factory root as `$1`
  - Fetch in `repo`. Refuse on local edits in `code`, as today. Build `releases/<sha>`: worktree, `.env` link, `npm ci`, images and Hermes when their paths changed. Swap `releases/current` with `ln -sfn` to a temp name and `mv -T`. Write `deployed`, then prune.
  - Prune: every release folder except the current one, whose path no `/proc/*/cwd` starts with, goes by `git worktree remove --force`, then `git worktree prune`. A failed removal logs and retries on the next deploy. That answers UK1.
  - No pause file and no waiting. A failure writes `update-failed` and leaves `current` alone.
  - Respects: IV1, IV2, IV3, AS4
- 1.3 `infra/deploy/deploy.py:22-57, 136-150`, `infra/factory_infra/__init__.py:20`, `infra/deploy/provision.py:124`, `infra/deploy/status.py:24`, `infra/files/roam-factory-update.service.j2`
  - Add `REPO_DIR`, `RELEASES_DIR` and `FACTORY_ENV`. Push the env to `FACTORY_ENV`. Replace the clone step by cloning into `REPO_DIR` once, then install and run `factory-layout.sh`. The update service passes the root. Provision stops making `CODE_DIR`. Status reads `FACTORY_ENV`. Hermes compose gets `FACTORY_CODE_SOURCE=/opt/factory` and `FACTORY_CODE_TARGET=/opt/factory`.
- 1.4 `hermes/compose.yaml:39`, `hermes/claude-run:16`
  - The volume becomes `${FACTORY_CODE_SOURCE:-../..}:${FACTORY_CODE_TARGET:-/factory/code}:ro`, so the Mac keeps today's mount. `claude-run` reads `/opt/factory/factory.env`.
- 1.5 `src/paused-tick.ts`, `src/paused-tick.test.ts` (delete), `src/cli.ts:7-30`, `src/pause.ts:13-26`, `src/config.ts:38,49`, `src/config.test.ts:11`, `settings.env:22-23`
  - A paused tick logs and returns. Drop `isDrainingUpdatePause`, `pausedSince`, `UPDATE_PAUSE_PREFIX`, `updateFailedFile` and `FACTORY_UPDATE_GRACE_MINUTES`.
- 1.6 `infra/tests/test_update_scripts.py` (create)
  - Runs both scripts against a temp root with a local git remote and `npm`, `docker` and `systemctl` shims on `PATH`.
- Commit: Deploy each main into its own folder, so a deploy never waits for or stops a job

### PH2 — Resume
- 2.1 `src/sessions.ts` (create)
  - `sessionsDir(home: string, issue: number): string` gives `$FACTORY_HOME/sessions/issue-N`.
  - `roundSession(home: string, issue: number, round: string, resuming: boolean): AgentSession` reuses `<round>.id` when resuming and it exists. Otherwise it writes a fresh UUID by temp file and rename.
  - `clearSessions(home: string, issue: number): void`.
- 2.2 `src/types.ts:150`, `src/container.ts:76-95`
  - `AgentRun` gains `session?: AgentSession`, with `AgentSession = { dir: string; id: string; resume: boolean }`. The agent mounts `dir` at `/home/pwuser/.claude/projects` and passes `--resume <id>` or `--session-id <id>`.
  - Respects: AS1
- 2.3 `src/stages/common.ts:42-45, 105-116`, `src/stages/adhoc.ts:20-28`, `src/stages/{triage,design,implement,testing}.ts`
  - `runAgent(ctx, issue, stage, round: string, prompt)`. Testing passes `test` and `test-fix`, the rest pass the stage. When the session resumes, the prompt is `RESUME_NOTE` alone. Otherwise it is the full prompt with media. `INTERRUPTED_NOTE` goes.
  - `prepareOutputs(ctx, issue, home)` resets `.factory/` unless the issue is in `interrupted`. The five agent and test stages call it in place of `resetOutputs`. Ad hoc gets its session through `roundSession` directly.
  - Respects: IV7, PC2
- 2.4 `src/tick.ts:125-180, 199`, `src/jobs.ts:37-44`
  - `checkJob`: a dead agent or test job in time, whose issue has no `interrupted` mark, goes to `resumeJob`. That is the current `interruptJob`, renamed, with its log line naming the resume. Every other dead job fails as today.
  - Drop `drainJobs`, `stoppable`, `inContainer` and `TickDeps.inContainer`. Drop `releaseAnswered`'s `mayRelease` parameter, whose only caller was the paused tick.
  - Respects: IV4, IV5, IV6
- 2.5 `src/job.ts:46-81`
  - `runJob` clears the issue's sessions before dispatch when the job is agent or test and the issue has no mark. `clearJob` also clears the sessions of agent and test jobs.
  - Respects: IV7
- 2.6 `src/types.ts:108`: the `interrupted` comment names dead jobs, not updates.
- Commit: Resume a dead agent or test job once, with its agents' conversations

### PH3 — Docs
- `README.md:32,48`, `infra/README.md:28-60`, `docs/tasks/game-factory.md:34-35`, `hermes/SOUL.md:84-93,114,138,172-174`: the layout, the deploy without a pause, resume and Hermes's code path.
- Commit: Document code folders and job resume

### Test strategy
- TDD in PH2: `sessions.test.ts`, `tick.test.ts` for resume once, the second death, a timeout and a dead branch job, `container.test.ts` for the mount and both flags, `common.test.ts` for the resume prompt and kept outputs, and `job.test.ts` for clearing.
- PH1: `test_update_scripts.py` covers a deploy, a deploy while a process sits in the old release, the prune after it ends, a failed `npm ci` and the migration of a real `code` folder.
- AS1 is checked by hand with the local `claude`: a run with `--session-id`, then `--resume` from a copied sessions folder.

### Order & dependencies
- PH1 and PH2 run in parallel. PH3 follows both.
- The server rollout follows the merge: install the scripts and run `deploy.py` once.

### Risks / rollback
- RK1 — The migration moves the live code folder. The tick timer stops for its length, and running jobs keep their moved working folder. Rollback: point `code` at `repo`.
- RK2 — An old job on an old release writes `state.json` beside new ticks. PC1 keeps that safe.

### Interfaces
- IF1 — `FactoryConfig` loses `updateGraceMinutes`. PH1 drops the key in `config.ts`, PH2 the field in `types.ts`.
- IF2 — `releaseAnswered(ctx, cards)` without `mayRelease`. PH2 changes it, PH1 deletes its other caller.

### Interface graph
- PH1 -> @ factory/infra/, factory/hermes/compose.yaml, factory/hermes/claude-run, factory/src/paused-tick.ts, factory/src/paused-tick.test.ts, factory/src/cli.ts, factory/src/pause.ts, factory/src/pause.test.ts, factory/src/config.ts, factory/src/config.test.ts, factory/settings.env
- PH2 -> IF1, IF2 @ factory/src/sessions.ts, factory/src/sessions.test.ts, factory/src/types.ts, factory/src/container.ts, factory/src/container.test.ts, factory/src/stages/, factory/src/tick.ts, factory/src/tick.test.ts, factory/src/jobs.ts, factory/src/job.ts, factory/src/job.test.ts, factory/src/state.ts
- PH3 IF1, IF2 -> @ factory/README.md, factory/infra/README.md, factory/docs/tasks/game-factory.md, factory/hermes/SOUL.md

## Verify

Result: passed

Happy-path:
- CK1 — a deploy on Linux with real `/proc` and GNU `mv -T` migrates a real `code` folder, builds, swaps and serves the new commit through `code` — held: `debian:bookworm-slim` smoke with shims for npm, docker, systemctl and sudo.
- CK2 — a resumed round continues its conversation in print mode — held locally: `claude -p --session-id`, then `--resume` with stdin, answered the code word from the first run.

Negative:
- CK3 — a card moved to another stage after a death resumes the wrong stage and keeps its outputs — broke, then fixed in `Resume only the stage whose process died`. The tick now writes the dead stage into the sessions folder, and only a job of that stage resumes.
- CK4 — a resumed round whose container died before Claude Code saved anything fails on `--resume` — broke in review of PH2, fixed: `roundSession` resumes only when `<id>.jsonl` exists.
- CK5 — the tick signals a dead job's pid, which another process may now own — broke in review of PH2, fixed: a dead job only loses its containers by label.

Invariants / assumptions:
- CK6 (IV1, IV2) — the update prunes a release a process still works in — held: the smoke kept the busy release and removed it once the process ended.
- CK7 (IV3) — a tick that read the link just before the swap finds its release pruned — held after a change: the previous release now survives one more deploy.
- CK8 (IV5, IV6) — a second death or a timeout resumes — held: `tick.test.ts` cases.
- CK9 (IV7) — a fresh job resumes an older session — held: `job.test.ts` and `common.test.ts` cases.
- CK10 (AS1) — resume works across two containers that share only the mounted projects folder — deferred: no local agent image or factory token. Checked during the rollout.

Interfaces:
- CK11 (IF1, IF2) — a caller still uses `updateGraceMinutes` or `mayRelease` — held: `tsc` is clean.
- CK12 — Hermes's code mount — held: `docker compose config` gives `../..` at `/factory/code` by default, and `/opt/factory` at the same path, read only, with the server variables.

Smoke: `tmp/smoke/run.sh` in Debian ran the layout migration and three deploys. Factory 456 tests, infra 22, Hermes 106, quality gate passed.
Goal: proxy only. The live rollout must show a deploy while jobs run, with no pause and no stop, and one job killed by hand that resumes its conversation.

## Conclusion

Outcome: the Goal held in the live rollout on 2026-10-03. Two updates switched releases while five jobs ran on, and a killed design job resumed its own Claude Code session.

Invariants:
- IV1, IV2, IV3 — Linux smoke and `test_update_scripts.py`: no pause, busy releases kept, the link swapped by `mv -T`.
- IV4 to IV7 — `tick.test.ts`, `job.test.ts`, `sessions.test.ts` and `common.test.ts`.

### Assumptions check
- AS1 — held on the server. Design #155 was killed with 85 session lines. The tick removed its container, and the next start ran `--resume` with the same id, which grew the same file.
- AS2 — unverifiable before the rollout. An image rebuild only changes later containers.
- AS3 — held as a design choice: the tick removes a dead job's containers by label in every case.
- AS4 — held in the Debian smoke as root. On the server the update runs as the factory user, which owns every job.

### Unknowns outcome
- UK1 — resolved: a release that cannot be removed is logged and retried on the next deploy, and never fails the update.

Plan adherence:
- PH1 and PH2 landed as one commit, `c63aa555`, since the hook type-checks each commit and neither phase compiles alone.
- The previous release survives one deploy, so a tick that read the link just before the swap still finds it.
- The tick writes the dead stage into the sessions folder, so a card that moved on starts fresh. The plan had only the `interrupted` mark.
- A dead job loses only its containers. Its pid is never signaled, since another process may own it by now.

Review findings:
- Important: the migration left the old update's `update to` pause, which the new code reads as Hermes's. Fixed: the layout script stops the update service and lifts that pause, with a test.

Rollout order: stop the update timer on the server, merge, then run `deploy.py` once. Otherwise the old update script deploys the merge in place first.

Rollout finding: the server mount of `/opt/factory` into Hermes hid the image's own files there, so Hermes failed its health check and the first update kept the old release. #189 moved them to `/opt/hermes-factory`.
