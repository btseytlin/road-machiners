# Operations

How the factory runs on its host: jobs, limits, cleanup, failures and records.

## Jobs and queues

Each job is its own process, started by the tick. [process.md](process.md#tick-and-queues) lists the queues and the order jobs start in. `FACTORY_<QUEUE>_WORKERS` sets each queue's limit, and the branch queue runs one job at a time. `FACTORY_<QUEUE>_TIMEOUT_MINUTES` sets each queue's time limit. Inside a job, an agent runs long commands with `factory-job`, and `FACTORY_JOB_MAX_MINUTES` caps the limit of each one. An issue has at most one job at a time. Each job's containers carry its id as a label, so a timeout kills only that job.

Jobs share the host clone and the state file. Each git step and each state update runs under a lock in `$FACTORY_HOME/locks` or next to the state file. A lock of a dead process is taken over.

GitHub holds every branch. The host clone `$FACTORY_HOME/repo` keeps GitHub's branches as `origin/*`, and each fetch deletes any local branch. A merge or a revert runs in a throwaway worktree and pushes at once. A conflict or a rejected push leaves GitHub as it was, so a retry starts from GitHub. An agent's work reaches GitHub only after the factory checks its diff.

A work clone with no commit checked out, like one a full disk cut short, holds no work. The next job deletes it and clones again, and its log names the folder.

## CPU pools

Each job's containers run on a fixed set of CPUs. `FACTORY_CPU_LIGHT`, `FACTORY_CPU_IMPLEMENT` and `FACTORY_CPU_TEST` set each pool's share, and each pool gets round(share × cores) whole CPUs, at least 1. The pools must fit the host, or every job start throws.

- light: triage, waste review, design and branch jobs.
- implement: implementation, patch, ad hoc, change and verify jobs.
- test: checks.

On the 8-core host that is CPU 0, CPUs 1-3 and CPUs 4-7. A pool never borrows from another, so the checks always get their CPUs. Docker pins containers with `--cpuset-cpus`. A step run by hand is not pinned.

`FACTORY_VITEST_WORKERS_IMPLEMENT` and `FACTORY_VITEST_WORKERS_TEST` set how many workers the game's test runner starts in a container of each pool. The factory passes the count as `TEST_WORKERS`. Light containers get none and keep the game's rule of one worker per CPU.

## Memory

Memory, not CPU, limits how many jobs fit on the host. Each container prints its cgroup's peak memory when it ends. The job keeps the highest peak of its containers and writes it to its ledger line as `peakGb`. A container killed before its end prints none.

`FACTORY_GPU=on` gives every container the host's NVIDIA GPU, and the playtest checks the frame rate. `off` runs the playtest with `--cpu`, with fewer turns and no frame rate check.

## Daily cap

The factory starts at most `FACTORY_MAX_JOBS_PER_DAY` public jobs in any 24 hours: triage, design, implementation, patch, verify, the release cut, the release playtest and the candidate. Checks, approve, remove, ship, change, ad hoc, incident, dev and waste jobs do not count. Hotfix jobs count but run at the cap. The cap sends no chat message. The dashboard shows the work it holds back and the time the next slot frees.

One card may start at most `FACTORY_MAX_JOBS_PER_CARD` of those jobs in any 24 hours. A card at its limit waits with the reason `card-budget` until its oldest start leaves the window, and other cards keep the daily cap. Hotfix jobs count but run at the limit.

## Resume

A job whose process dies within its time limit resumes once. This covers a crash, a memory kill or a reboot. Each issue keeps its agents' Claude Code sessions in `$FACTORY_HOME/sessions/issue-N`. The tick removes the dead job's containers, puts the issue in `interrupted` and frees its cap slot. The next tick starts the same stage, and each agent round continues its session with `--resume`. Merges, checks and publishing run again. A second death or a timeout fails the job. A dead branch job always fails, since a restart could repeat a half-done branch move. A job's end clears the sessions and the mark.

## Cleanup and health

Every tick, after it checks the running jobs:

- It deletes each folder in the web root except `dev`, `concepts` and the builds of cards in Approval. It skips this while a checks or branch job runs, since those deploy builds.
- It deletes the clones in `$FACTORY_HOME/work` of finished work: issues whose card is Done or off the board, `check-issue-*`, `dev-build`, `release-main`, `change-*` and `incident-*` not queued, `release-playtest`, and `release-candidate` with no release open. The playtest audit in `$FACTORY_HOME/playtest/` stays. A clone that stays loses its `node_modules`. A running or interrupted job keeps its clones. Folders with other names stay, and the tick log names them.
- It deletes job logs older than `FACTORY_LOG_DAYS`, except `tick.log`, `update.log` and the logs that `failures` names.

Every tick writes `$FACTORY_HOME/health` with its time, the free disk and the available memory, also while paused. Under `FACTORY_MIN_FREE_GB` free, the tick starts no job. Memory under `FACTORY_MIN_AVAILABLE_GB` blocks nothing, and a host with no `/proc/meminfo` records none.

When `dev` moves past the commit `/dev/` serves, the next tick rebuilds `/dev/`, so a merge made outside the factory reaches the dev link too. A failed build records its commit in `devFailed`, and the tick skips it until `dev` moves again.

## Failures and Hermes

Each factory process sends its GitHub calls one at a time, as GitHub asks. A call that hits a rate limit waits `FACTORY_GITHUB_RETRY_BASE_SECONDS` and runs again, up to `FACTORY_GITHUB_RETRIES` times, with the wait doubled each time. Any other GitHub error fails at once. A call that runs past `FACTORY_GITHUB_TIMEOUT_SECONDS` is killed and fails, so a dead connection cannot hang a tick. It does not run again, since a write may have landed.

A failed or timed-out job labels its issue `factory-stuck` and records the failure in `failures` for a day. The factory posts nothing about it. A stuck release step labels the tracking issue. Removing the label lets the factory try again.

An agent run that ends on the Claude weekly usage limit is the exception. The factory writes `Hermes: Claude weekly usage limit; <message>` to `$FACTORY_HOME/paused`, unless a pause is already there. The job still records its failure, but the card takes no label. Hermes resumes the factory after the reset, and the card runs its stage again.

Hermes manages the factory. Its incident watch wakes it on a stuck issue, a failed job, a tick crash in `lastTickError`, a failed `/dev/` build, a failed factory update, low disk, low memory, no tick for 20 minutes or a pause older than an hour. It also wakes on each `drift: <line>`, which is one line of `factory audit`, so Hermes fixes stale state before it blocks a card. Each call to GitHub and to `factory audit` has a time limit. A source that fails or times out repeats its last answer, so no known incident closes, and after 10 minutes it adds a `<source> failed since <time>` line. A failed or killed watch run stays in Hermes's cron log and never reaches the chat. Only Hermes's own messages do. Hermes reads the logs, the state and the chat, then fixes the incident. It asks the committee only about game design or taste, or when it tried and could not fix it. [hermes/SOUL.md](../hermes/SOUL.md) holds its rules.

Hermes uses the `factory` CLI for every look at the factory and every change. Read commands print the state and change nothing. Write commands become inbox commands, and the next tick applies each one before it picks jobs. A write that cannot apply changes nothing and becomes a failure that names the reason. Each write names who ordered it and why, on the issue and in the ledger. Only a member's order runs `merge` of a card the committee has not approved, `ship` and `merge-change`. `factory help` lists every command. [state.md](state.md) lists the commands.

While Hermes edits state, it pauses the factory with the file `$FACTORY_HOME/paused`, and every tick skips. A paused tick also skips its job checks, so a dead job stays in `jobs` until the pause ends. A line `pid: N` in that file ties the pause to a process, and the tick lifts the pause once that process ends.

## Activity and status

Each job reports a heartbeat every `FACTORY_OBSERVATION_HEARTBEAT_MS`. Agents report their phase with `factory-status`, and Hermes with its hooks and `factory_report_activity`, with no free text. The tick reports why each job waits. The public [dashboard](../dashboard/README.md) shows all of it, and Hermes's `factory_status` tool reads the same snapshot.

## Chat answers

When a member acts on a post by button or reply, the factory adds a status line under its caption, like "Approved by Ann", and drops its buttons. The state keeps each open post's caption for this, since Telegram cannot read one back. A command on a post answers with that status line alone. A waived approval post is a text message, so its status line edits the text, not a caption. `/change` and `/waive-visual` get one reply from the tick. An ad hoc task gets Hermes's reply, then the report, then any files. Errors always get a reply.

## Ledger and waste review

Every job adds one line to `$FACTORY_HOME/ledger.jsonl` when it ends: its id, stage, issue, start, end, outcome and agent runs. The tick writes the line of a job that died or timed out. Each agent run reads its model, cost and minutes from the `result` event of its stream-json output. A finished agent run with no `result` event fails its job.

A run cut off before its `result` event still costs money. This covers a crash, a timeout, a dead job process and a usage limit. Every run keeps its Claude Code transcript on the host, in the issue's sessions folder or in `$FACTORY_HOME/usage/<job>.projects`. The run's open record in `$FACTORY_HOME/usage/<job>.run.json` names it. Whoever ends the run or the job prices that transcript at `FACTORY_MODEL_PRICES` and marks the run `fromTranscript`. These list prices give the same cost Claude Code reports for a finished run. The dashboard shows the spend of every job that failed, died or timed out as wasted.

Every routed approval reply adds a line too.

Every card move adds a card line: the issue, the new column, the time and a step that names the move. `src/card-events.ts` writes it after the board takes the move, and no other code moves a card. A line holds no actor, comment or reason.

- Normal path: `entered`, `accepted`, `planned`, `built`, `patched`, `posted`, `approved`, `hardened` and `merged`.
- Loops back: `questions`, `rebuild`, `plan-wrong`, `review-failed`, `patch`, `redesign`, `patch-replan`, `conflict`, `removed` and `unbundled`.
- Early ends: `triage-wont-do`, `design-wont-do`, `bundled`, `denied`, and `dropped` by `factory move N done`.
- Other moves: `moved` by `factory move`, `merge-ordered` by `factory merge`, `shipped` for the release card and `reported` for an ad hoc task.
- A line carries `flow` when the card is a hotfix, a release task, the release card or an ad hoc task.

A triage `unclear` verdict moves nothing, so its wait for the author stays in Triage. A move by hand on GitHub writes no line.

Every `FACTORY_WASTE_REVIEW_DAYS`, the tick starts a waste review in the triage queue. `wasteNumbers()` in `src/waste.ts` computes the cost per stage and model, the wait per queue, the stages that ran more than once on one issue, the routes and the most expensive issues. It computes the same numbers for the period before, so a jump shows. A Sonnet agent reads those numbers and the records, and writes `.factory/brief.md` with one bottleneck and one change request. The job records them in a closed issue labeled `factory-review` and writes `$FACTORY_HOME/review-pending`. That file is an incident line for Hermes. Hermes checks the review and posts to the committee only when something matters, then deletes the file. A member queues the change by asking Hermes. The first review waits one full period after the deploy.

## Deploying the factory

The server runs the factory from GitHub's `main`, and only from there. To change factory code or `settings.env`, merge it into `main`. Every 2 minutes, `factory-update` checks `main`. When `main` moved, it builds the new commit in its own release folder, with no pause, and records the commit in `$FACTORY_HOME/deployed`. It refuses a code dir with local edits. [infra/README.md](../infra/README.md) has the details.
