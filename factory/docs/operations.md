# Operations

How the factory runs on its host: jobs, limits, cleanup, failures and records.

## Jobs and queues

Each job is its own process, started by the tick. [process.md](process.md#tick-and-queues) lists the queues and the order jobs start in. `FACTORY_<QUEUE>_WORKERS` sets each queue's limit, and the branch queue runs one job at a time. `FACTORY_<QUEUE>_TIMEOUT_MINUTES` sets each queue's time limit. An issue has at most one job at a time. Each job's containers carry its id as a label, so a timeout kills only that job.

Jobs share the host clone and the state file. Each git step and each state update runs under a lock in `$FACTORY_HOME/locks` or next to the state file. A lock of a dead process is taken over.

GitHub holds every branch. The host clone `$FACTORY_HOME/repo` keeps GitHub's branches as `origin/*`, and each fetch deletes any local branch. A merge or a revert runs in a throwaway worktree and pushes at once. A conflict or a rejected push leaves GitHub as it was, so a retry starts from GitHub. An agent's work reaches GitHub only after the factory checks its diff.

## CPU pools

Each job's containers run on a fixed set of CPUs. `FACTORY_CPU_LIGHT`, `FACTORY_CPU_IMPLEMENT` and `FACTORY_CPU_TEST` set each pool's share, and each pool gets round(share × cores) whole CPUs, at least 1. The pools must fit the host, or every job start throws.

- light: triage, waste review, design and branch jobs.
- implement: implementation, patch, ad hoc, change and verify jobs.
- test: checks.

On the 8-core host that is CPU 0, CPUs 1-3 and CPUs 4-7. A pool never borrows from another, so the checks always get their CPUs. Docker pins containers with `--cpuset-cpus`, which the game's test runner sees. A step run by hand is not pinned.

`FACTORY_GPU=on` gives every container the host's NVIDIA GPU, and the playtest checks the frame rate. `off` runs the playtest with `--cpu`, with fewer turns and no frame rate check.

## Daily cap

The factory starts at most `FACTORY_MAX_JOBS_PER_DAY` public jobs in any 24 hours: triage, design, implementation, patch, verify, checks, the release cut and the candidate. Approve, remove, ship, change, ad hoc, incident, dev and waste jobs do not count. Hotfix jobs count but run at the cap. The first time the cap blocks work, the committee chat gets one notice with the time the next slot frees.

## Resume

A job whose process dies within its time limit resumes once. This covers a crash, a memory kill or a reboot. Each issue keeps its agents' Claude Code sessions in `$FACTORY_HOME/sessions/issue-N`. The tick removes the dead job's containers, puts the issue in `interrupted` and frees its cap slot. The next tick starts the same stage, and each agent round continues its session with `--resume`. Merges, checks and publishing run again. A second death or a timeout fails the job. A dead branch job always fails, since a restart could repeat a half-done branch move. A job's end clears the sessions and the mark.

## Cleanup and health

Every tick, after intake:

- It deletes each folder in the web root except `dev`, `concepts` and the builds of cards in Approval. It skips this while a checks or branch job runs, since those deploy builds.
- It deletes the clones in `$FACTORY_HOME/work` of finished work: issues whose card is Done or off the board, `check-issue-*`, `dev-build`, `release-main`, `change-*` and `incident-*` not queued, and `release-candidate` with no release open. A clone that stays loses its `node_modules`. A running or interrupted job keeps its clones. Folders with other names stay, and the tick log names them.
- It deletes job logs older than `FACTORY_LOG_DAYS`, except `tick.log`, `update.log` and the logs that `failures` names.

Every tick writes `$FACTORY_HOME/health` with its time, the free disk and the available memory, also while paused. Under `FACTORY_MIN_FREE_GB` free, the tick starts no job. Memory under `FACTORY_MIN_AVAILABLE_GB` blocks nothing, and a host with no `/proc/meminfo` records none.

When `dev` moves past the commit `/dev/` serves, the next tick rebuilds `/dev/`, so a merge made outside the factory reaches the dev link too. A failed build records its commit in `devFailed`, and the tick skips it until `dev` moves again.

## Failures and Hermes

A failed or timed-out job labels its issue `factory-stuck` and records the failure in `failures` for a day. The factory posts nothing about it. A stuck release step labels the tracking issue. Removing the label lets the factory try again.

Hermes manages the factory. Its incident watch wakes it on a stuck issue, a failed job, a tick crash in `lastTickError`, a failed `/dev/` build, a failed factory update, low disk, low memory, no tick for 20 minutes or a pause older than an hour. Hermes reads the logs, the state and the chat, then fixes the incident or asks the committee. [hermes/SOUL.md](../hermes/SOUL.md) holds its rules.

While Hermes edits state, it pauses the factory with the file `$FACTORY_HOME/paused`, and every tick skips. A paused tick also skips its job checks, so a dead job stays in `jobs` until the pause ends. A line `pid: N` in that file ties the pause to a process, and the tick lifts the pause once that process ends.

## Chat answers

When a member acts on a post by button or reply, the factory adds a status line under its caption, like "Approved by Ann", and drops its buttons. The state keeps each open post's caption for this, since Telegram cannot read one back. A command on a post answers with that status line alone. `/change` gets one reply from the tick. An ad hoc task gets Hermes's reply, then the report, then any files. Errors always get a reply.

## Ledger and waste review

Every job adds one line to `$FACTORY_HOME/ledger.jsonl` when it ends: its id, stage, issue, start, end, outcome and agent runs. The tick writes the line of a job that died or timed out. Each agent run reads its model, cost and minutes from the `result` event of its stream-json output. A finished agent run with no `result` event fails its job, since its cost would be unknown. Every routed approval reply adds a line too.

Every `FACTORY_WASTE_REVIEW_DAYS`, the tick starts a waste review in the triage queue. `wasteNumbers()` in `src/waste.ts` computes the cost per stage and model, the wait per queue, the stages that ran more than once on one issue, the routes and the most expensive issues. A Sonnet agent reads those numbers and the records, and writes `.factory/brief.md` with one bottleneck and one change request. The job records them in a closed issue labeled `factory-review`. The committee chat gets the bottleneck and a "Queue as change" button. The first review waits one full period after the deploy.

## Deploying the factory

The server runs the factory from GitHub's `main`, and only from there. To change factory code or `settings.env`, merge it into `main`. Every 2 minutes, `factory-update` checks `main`. When `main` moved, it builds the new commit in its own release folder, with no pause, and records the commit in `$FACTORY_HOME/deployed`. It refuses a code dir with local edits. [infra/README.md](../infra/README.md) has the details.
