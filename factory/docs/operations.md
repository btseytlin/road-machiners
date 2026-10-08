# Operations

How the factory runs on its host: jobs, limits, cleanup, failures and records.

## Jobs and queues

Each job is its own process, started by the tick. [process.md](process.md#tick-and-queues) lists the queues and the order jobs start in. `FACTORY_<QUEUE>_WORKERS` sets each queue's limit. The branch queue has no limit. Its jobs run side by side, and each one locks the shared folders it uses under `$FACTORY_HOME/locks`: `dev-build`, `release-main`, `merge-queue`, `ship-main` and each `merge-<branch>` conflict clone. A job waits for a locked folder at most `FACTORY_BRANCH_TIMEOUT_MINUTES`, and the cleanup sweep skips it. `FACTORY_<QUEUE>_TIMEOUT_MINUTES` sets each queue's time limit. Merge and Ship run the full checks and a fix loop, so both get `FACTORY_MERGE_TIMEOUT_MINUTES`. Inside a job, an agent runs long commands with `factory-job`, and `FACTORY_JOB_MAX_MINUTES` caps the limit of each one. An issue has at most one job at a time. Each job's containers carry its id as a label, so a timeout kills only that job.

Jobs share the host clone and the state file. Each git step and each state update runs under a lock in `$FACTORY_HOME/locks` or next to the state file. A lock of a dead process is taken over.

GitHub holds every branch. The host clone `$FACTORY_HOME/repo` keeps GitHub's branches as `origin/*`, and each fetch deletes any local branch. A merge or a revert runs in a throwaway worktree and pushes at once. A conflict or a rejected push leaves GitHub as it was, so a retry starts from GitHub. A conflict between branches goes to an agent in a work clone named `$FACTORY_HOME/work/merge-<branch>`, and its commit reaches GitHub only after the factory checks it. An agent's work reaches GitHub only after the factory checks its diff.

A work clone with no commit checked out, like one a full disk cut short, holds no work. The next job deletes it and clones again, and its log names the folder.

## CPU pools

Each job's containers run on a fixed set of CPUs. `FACTORY_CPU_LIGHT`, `FACTORY_CPU_IMPLEMENT` and `FACTORY_CPU_TEST` set each pool's share, and each pool gets round(share × cores) whole CPUs, at least 1. The pools must fit the host, or every job start throws.

- light: triage, waste review, design and branch jobs other than the merge and the candidate.
- implement: implementation, ad hoc, change, verify, harden and release playtest jobs. The Testing job runs its preview checks here.
- test: the merge job, which runs the full suite, the candidate, which checks the frame rate, and the post-only checks.

On the 8-core host that is CPU 0, CPUs 1-3 and CPUs 4-7. A pool never borrows from another, so the merge checks always get their CPUs. Docker pins containers with `--cpuset-cpus`. A step run by hand is not pinned.

`FACTORY_VITEST_WORKERS_IMPLEMENT` and `FACTORY_VITEST_WORKERS_TEST` set how many workers the game's test runner starts in a container of each pool. The factory passes the count as `TEST_WORKERS`. Light containers get none and keep the game's rule of one worker per CPU.

## Memory

Memory, not CPU, limits how many jobs fit on the host. Each container prints its cgroup's peak memory when it ends. The job keeps the highest peak of its containers and writes it to its ledger line as `peakGb`. A container killed before its end prints none.

`FACTORY_GPU=on` gives every container the host's NVIDIA GPU, and the playtest checks the frame rate. `off` runs the playtest with `--cpu`, with fewer turns and no frame rate check.

## Card job limit

The factory has no limit on the jobs it starts per day. The Claude usage-limit pause guards the shared limit.

One card may start at most `FACTORY_MAX_JOBS_PER_CARD` jobs in any 24 hours. The jobs that count are triage, design, implementation, verify, harden, the release cut, the release playtest and the candidate. Checks, approve, merge, remove, ship, change, ad hoc, incident, dev and waste jobs do not count. A card at its limit waits with the reason `card-budget` until its oldest start leaves the window. Hotfix jobs count but run at the limit.

## Resume

A card job whose process dies within its time limit resumes once. This covers a crash, a memory kill or a reboot. A card job that runs past its time limit resumes once too. The tick kills it first and writes the ledger outcome `timeout`. Each issue keeps its agents' Claude Code sessions in `$FACTORY_HOME/sessions/issue-N`. The tick removes the job's containers, puts the issue in `interrupted` and frees its card job limit slot. The next tick starts the same stage, and each agent round continues its session with `--resume`. Merges, checks and publishing run again. A second death or a second timeout fails the job. A dead or timed-out branch job always fails, since a restart could repeat a half-done branch move. A dead job past its time limit fails too. A job's end clears the sessions and the mark.

`factory pause-card N` uses the same path. It kills the card's job, puts the issue in `interrupted` and frees its card job limit slot, and the card waits until `resume-card N`. The continued job counts as resumed once, so its death fails it.

## Cleanup and health

Every tick, after it checks the running jobs:

- It deletes each folder in the web root except `dev`, `concepts` and the builds of cards in Approval or Hardening. It skips this while a verify, checks or branch job runs, since those deploy builds before they record them.
- It deletes the clones in `$FACTORY_HOME/work` of finished work: issues whose card is Done or off the board, `check-issue-*`, `merge-queue`, `dev-build`, `release-main`, `change-*` and `incident-*` not queued, `release-playtest`, `release-baseline`, and `release-candidate` with no release open. The playtest audit in `$FACTORY_HOME/playtest/` stays. A clone that stays loses its `node_modules`. A running or interrupted job keeps its clones. Folders with other names stay, and the tick log names them.
- It deletes job logs older than `FACTORY_LOG_DAYS`, except `tick.log`, `update.log` and the logs that `failures` names.
- It deletes archived agent transcripts older than `FACTORY_TRANSCRIPT_DAYS`.
- It deletes files older than `FACTORY_TEST_CACHE_DAYS` in `$FACTORY_HOME/test-cache/`, then the empty folders. The game test tool owns this folder and touches an entry each time it skips a test file on it. Only the check containers of the post and merge checkpoints mount the folder, and the release playtest runs the full suite without it.

Every tick writes `$FACTORY_HOME/health` with its time, the free disk and the available memory, also while paused. Under `FACTORY_MIN_FREE_GB` free, the tick starts no job. Memory under `FACTORY_MIN_AVAILABLE_GB` blocks nothing, and a host with no `/proc/meminfo` records none.

When `dev` moves past the commit `/dev/` serves, the next tick rebuilds `/dev/`, so a merge made outside the factory reaches the dev link too. A failed build records its commit in `devFailed` and what broke in `devError`, and the tick skips it until `dev` moves again. The incident watch shows both to Hermes, which fixes `dev` or reverts the merge that broke it.

## Repairing a work clone

A failed merge can leave a card's work clone with an open merge, conflicts or thousands of dirty files. The next job reuses any clone with a commit. A stage resumes its own unfinished merge of the base or of the issue branch, so those need no repair. Any other open merge fails the stage again. `factory repair-clone N --by <who> --reason <why>` swaps the clone for a fresh one and keeps the old one.

1. Run `factory repair-clone N --by hermes --reason <why>`. Add `--backup-merge` when the clone has an open merge, revert, cherry-pick or rebase, or conflicted files. Without it the command refuses such a clone.
2. Check the new clone. A repair that works already removed the stuck label and the failures, so the next tick continues the card.

The command needs no pause and no other idle card. It holds the card for its duration, takes the clone lock `$FACTORY_HOME/locks/issue-N`, and lifts only the hold it placed. A hold that was there before stays, and so does the `interrupted` mark, so a held card resumes in the new clone after `resume-card`. A job start, `prepareWorkClone` and the tick sweep of `work/issue-N` wait for that lock or skip the clone. The command acts at once. It refuses, and changes nothing in `work/`, when:

- a job of the card runs;
- `--by` is no member and not `hermes`;
- `work/issue-N` holds no clone with a commit, since the next job clones that again;
- the clone has an open operation or conflicts and no `--backup-merge`;
- the host clone, freshly fetched, has no `factory/issue-N`.

A repair fetches the host clone, then clones GitHub's `factory/issue-N` exactly, with fresh `origin/*` refs like `dev`. It moves the whole old clone, with its tracked, untracked and ignored files, to `$FACTORY_HOME/clone-backups/issue-N-<time>/clone`. `repair.json` beside it records who, why, the old HEAD and branch, the open operation, the conflicted files, the commits on no GitHub branch and the outcome. `status.txt` holds the old `git status`. Only the `.factory`, `.factory-tasks` and `.factory-media` folders are copied into the new clone. The repair passes only when the new clone's `git status` is clean and its HEAD is the branch head.

A failure after the move keeps the backup where it is, moves the half-made clone to `failed-fresh` in the backup and leaves `work/issue-N` free. The error prints the `mv` that restores the old clone. Nothing deletes a backup. The tick sweep reads only `work/`, so Hermes deletes a backup once the card is past the trouble. A failed repair leaves the stuck label and the failures in place.

## Failures and Hermes

Each factory process sends its GitHub calls one at a time, as GitHub asks. A call that hits a rate limit waits `FACTORY_GITHUB_RETRY_BASE_SECONDS` and runs again, up to `FACTORY_GITHUB_RETRIES` times, with the wait doubled each time. Any other GitHub error fails at once. A call that runs past `FACTORY_GITHUB_TIMEOUT_SECONDS` is killed and fails, so a dead connection cannot hang a tick. It does not run again, since a write may have landed.

A card stage that fails resumes once on the next tick in its own sessions, and its agent gets the error. It takes no label and records no failure. A failed job after that, a branch job that timed out, a stage that spent its budget or asked the committee, and any other failed job labels its issue `factory-stuck` and records the failure in `failures` for a day. A failed merge job labels every card of its batch. The factory posts nothing about it. A stuck release step labels the tracking issue. Removing the label lets the factory try again.

An agent run that ends on the Claude weekly usage limit is the exception. The factory writes `Hermes: Claude weekly usage limit; <message>` to `$FACTORY_HOME/paused`, unless a pause is already there. The job still records its failure, but the card takes no label. Hermes resumes the factory after the reset, and the card runs its stage again.

Hermes manages the factory. Its incident watch wakes it on a stuck issue, a failed job, a tick crash in `lastTickError`, a failed `/dev/` build, a failed factory update, low disk, low memory, no tick for 20 minutes or a pause older than an hour. It also wakes on each `drift: <line>`, which is one line of `factory audit`, so Hermes fixes stale state before it blocks a card. Each call to GitHub and to `factory audit` has a time limit. A source that fails or times out repeats its last answer, so no known incident closes, and after 10 minutes it adds a `<source> failed since <time>` line. A failed or killed watch run stays in Hermes's cron log and never reaches the chat. Only Hermes's own messages do. Hermes reads the logs, the state and the chat, then fixes the incident. No failure waits for a person. When a fix fails, Hermes tries another approach, and a card that keeps failing goes back to Design with the findings. Hermes reports what it did and asks the committee only about product decisions and game design or taste. Hermes may push a merge to `dev` after the factory checks pass. [hermes/SOUL.md](../hermes/SOUL.md) holds its rules.

Hermes uses the `factory` CLI for every look at the factory and every change. Read commands print the state and change nothing. Write commands become inbox commands, and the next tick applies each one before it picks jobs. A write that cannot apply changes nothing and becomes a failure that names the reason. Each write names who ordered it and why, on the issue and in the ledger. Only a member's order runs `merge` or `move N harden` of a card the committee has not approved, `ship` and `merge-change`. `factory help` lists every command. [state.md](state.md) lists the commands.

While Hermes edits state, it pauses the factory with the file `$FACTORY_HOME/paused`, and every tick starts no job, applies no order, runs no cleanup and takes no intake. A paused tick still checks the running jobs, so a dead or timed-out job leaves `jobs` also during a pause. A line `pid: N` in that file ties the pause to a process, and the tick lifts the pause once that process ends.

## Activity and status

Each job reports a heartbeat every `FACTORY_OBSERVATION_HEARTBEAT_MS`. Agents report their phase with `factory-status`, and Hermes with its hooks and `factory_report_activity`, with no free text. The tick reports why each job waits. The public [dashboard](../dashboard/README.md) shows all of it, and Hermes's `factory_status` tool reads the same snapshot.

## Chat answers

When a member acts on a post by button or reply, the factory adds a status line under its caption, like "Approved by Ann", and drops its buttons. The state keeps each open post's caption for this, since Telegram cannot read one back. A command on a post answers with that status line alone. An approval post with no screenshot is a text message, so its status line edits the text, not a caption. `/change` gets one reply from the tick. An ad hoc task gets Hermes's reply, then the report, then any files. Errors always get a reply.

## Ledger and waste review

Every job adds one line to `$FACTORY_HOME/ledger.jsonl` when it ends: its id, stage, issue, start, end, outcome and agent runs. The tick writes the line of a job that died or timed out, and `pause-card` the line of the job it held, with the outcome `held`. The dashboard and the waste review count a held job as neither finished nor failed, and its spend as no waste, since its stage continues in the same sessions. Each agent run reads its model, cost and minutes from the `result` event of its stream-json output. A finished agent run with no `result` event fails its job.

A run cut off before its `result` event still costs money. This covers a crash, a timeout, a dead job process and a usage limit. Every run keeps its Claude Code transcript on the host, in the issue's sessions folder or in `$FACTORY_HOME/usage/<job>.projects`. The run's open record in `$FACTORY_HOME/usage/<job>.run.json` names it. Whoever ends the run or the job prices that transcript at `FACTORY_MODEL_PRICES` and marks the run `fromTranscript`. These list prices give the same cost Claude Code reports for a finished run. The dashboard shows the spend of every job that failed, died or timed out as wasted.

Before the factory deletes a sessions folder or a run's projects folder, it copies every transcript in it to `$FACTORY_HOME/transcripts/<session>/`, with its subagents. The transcripts are kept to analyze what agents did, where they got stuck and what to optimize. Each run in the ledger names its `sessionId`, so a ledger line leads to its transcripts. An ad hoc task sees the ledger and the archive read only, so a member asks Hermes for such an analysis. The folder is a Claude Code projects folder, so `transcriptUsage()` in `src/transcript.ts` reads it.

Every routed approval reply adds a line too.

Every card move adds a card line: the issue, the new column, the time and a step that names the move. `src/card-events.ts` writes it after the board takes the move, and no other code moves a card. A line holds no actor, comment or reason.

- Normal path: `entered`, `accepted`, `planned`, `built`, `posted`, `approved`, `hardened` into Merging, and `merged`.
- Loops back: `questions`, `plan-wrong`, `patch` into Testing, `redesign`, `conflict` of a hotfix into Testing, `removed` and `unbundled`.
- Lines from before one session ran each stage also hold `patched`, `rebuild`, `review-failed` and `patch-replan`. No stage writes them now.
- Early ends: `triage-wont-do`, `design-wont-do`, `bundled`, `denied`, and `dropped` by `factory move N done`.
- Other moves: `moved` by `factory move`, `merge-ordered` by `factory merge`, `shipped` for the release card and `reported` for an ad hoc task.
- A line carries `flow` when the card is a hotfix, a release task, the release card or an ad hoc task.

A triage `unclear` verdict moves nothing, so its wait for the author stays in Triage. A move by hand on GitHub writes no line.

Every `FACTORY_WASTE_REVIEW_DAYS`, the tick starts a waste review in the triage queue. `wasteNumbers()` in `src/waste.ts` computes the cost per stage and model, the wait per queue, the stages that ran more than once on one issue, the routes and the most expensive issues. It computes the same numbers for the period before, so a jump shows. A Sonnet agent reads those numbers and the records, and writes `.factory/brief.md` with one bottleneck and one change request. The job records them in a closed issue labeled `factory-review` and writes `$FACTORY_HOME/review-pending`. That file is an incident line for Hermes. Hermes checks the review and posts to the committee only when something matters, then deletes the file. A member queues the change by asking Hermes. The first review waits one full period after the deploy.

## Error reports

The release, dev and candidate builds post each new game error to `/errors` on the public site. Card previews post nothing, since an error there belongs to the card's own review. The build that publishes a reporting build moves its source maps to `$FACTORY_HOME/sourcemaps/<commit>/` first, so no map goes public. Dev and candidate maps go after `FACTORY_ERROR_MAP_DAYS`, and release maps stay.

The error service is its own systemd unit, `roam-factory-errors`, with its log in `logs/errors.log`. `src/error-reports/` holds its code. It refuses a report from another origin, one over the size caps, one past `FACTORY_ERROR_IP_PER_HOUR` for its address, one from a commit it has no maps for, and one whose stack maps to no game source. Each refusal counts by reason in `$FACTORY_HOME/error-reports/store.json`.

A report it takes gets a fingerprint from the error and the top game frames. The issue body holds the fingerprint, so the service finds the issue on GitHub even with a lost store. A new fingerprint opens an issue labeled `bug` and `error-report`, at most `FACTORY_ERROR_DAILY_ISSUES` a day. A report from a commit the fingerprint has not seen comments on its open issue, and reopens a completed one when the build was published after the close. A `not planned` close stays closed. The service keeps one report file per fingerprint and commit, up to `FACTORY_ERROR_DISK_MB`. Agent stages of the issue get those files read-only at `/error-reports/`, and `npm run error:replay` in `game/` reruns their turn.

A daily cap, the disk cap or an address past its limit writes a line to `$FACTORY_HOME/error-reports/alert`. Hermes's incident watch prints it, and Hermes deletes the file once handled.

## Deploying the factory

The server runs the factory from GitHub's `main`, and only from there. To change factory code or `settings.env`, merge it into `main`. Every 2 minutes, `factory-update` checks `main`. When `main` moved, it builds the new commit in its own release folder, with no pause, and records the commit in `$FACTORY_HOME/deployed`. It refuses a code dir with local edits. [infra/README.md](../infra/README.md) has the details.
