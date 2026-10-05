# One source of truth for the factory

## Context

- The host clone at `$FACTORY_HOME/repo` keeps local `dev`, `main` and release branches. Every tick and many jobs fast-forward them from GitHub. A branch job merges into them locally, then pushes.
- A failed push leaves an unpushed merge on the local branch. On 2026-10-01 GitHub rejected the push of `main` once. The retry then found the release already merged locally, saw no features, and failed. Hermes repaired the clone by hand.
- A reset on every sync would race with branch jobs, because each git call takes the repo lock alone. The tick could reset `main` between a Ship's merge and its push.
- Issue branches live in the host clone. Work clones push into it with `fetchFromWork`, and only some stages push to GitHub.
- Factory code reaches the server by rsync from the laptop's working tree. `infra/server.env` on the laptop holds secrets and plain settings, and every deploy overwrites the server's `.env` with it.
- When Hermes or a `claude-run` job edits factory code or `.env` on the server, the next deploy erases the edit without a trace.
- `/change` opens its pull request against `dev`, but factory code is deployed from `main`.

## Desired design

GitHub holds every branch, and `main` on GitHub holds all factory code and settings. The server never keeps state of its own that a sync could clash with.

Game branches:

- The host clone becomes a fetch-only cache. It keeps no local `dev`, `main` or release branch. `sync()` becomes `fetch()`.
- A branch job writes through one call, `land(into, steps)`. It makes a temporary worktree, detached at `origin/<into>`, and runs the merges or reverts there. Then it pushes `HEAD:<into>` and removes the worktree. A failed merge or push leaves nothing behind, so a retry starts from GitHub.
- A hotfix lands into `main`, `dev` and the open release. It prepares one worktree per branch, then sends all of them in one `git push --atomic`. Either every branch moves or none does.
- An issue branch goes to GitHub as soon as a stage fetches it from its work clone. Work clones start from `origin/<branch>`, or from `origin/<base>` when the branch is new.
- Read calls such as `mergeLog`, `isMerged`, `changedFiles` and `diff` read `origin/*` refs.

Factory code and settings:

- Plain settings, like `FACTORY_MAX_JOBS_PER_DAY`, the worker limits and the models, move to `factory/settings.env`, which is committed. Secrets, committee ids and host paths stay in the server-only `factory/.env` that git never sees. It keeps its name, so `claude-run` and the compose files read it as before. The config loader reads both, and a key found in both files fails loudly.
- `/opt/factory/code` becomes a git checkout of `main`, owned by the factory user. Nothing rsyncs into it.
- A systemd timer runs `factory-update` every few minutes. When `origin/main` has moved past the deployed commit, the script pauses the factory and waits for `jobs` to empty. If jobs are still running, it tries again on the next run. Then it checks out the new commit and runs only the rebuilds the changed paths need: `npm ci`, the agent and proxy images, or Hermes. It records the commit and unpauses.
- If the checkout has local edits, the update stops and records an incident for Hermes. It never overwrites a hand edit without a trace.
- The pyinfra deploy shrinks to setup. It installs packages and units, pushes `.env` from the laptop's `infra/server.env`, makes the first clone, builds and sets up Caddy. It never sends code. To roll out code or settings, you merge to `main`. To roll out a secret, you edit `infra/server.env` and run the deploy.
- `/change` opens its pull request against `main`. You merge it on GitHub, and the update deploys it. Hermes stops editing factory code or settings on the server. It queues every change with a new tool, `factory_queue_change`, which runs the same change job.

Out of scope: game stages, the queue model, and how releases and approvals decide anything.

## Invariants and principles

- After any failed git step, the next job sees only GitHub's state. A test in `repo.test.ts` simulates a rejected push and then retries.
- A hotfix moves all of its branches or none of them. A test rejects one ref of the atomic push.
- The server runs exactly one commit of `origin/main`, recorded in `$FACTORY_HOME/deployed`. `git status --porcelain` in the code dir is empty after every update.
- No update swaps code or restarts Hermes while a job runs.
- Secrets never enter git. `settings.env` holds no token or key, and a config test checks the secret names.
- Nothing reaches `main` without a human: factory changes need your merge, and game changes need Ship or a hotfix approval.
- Fail loudly. An update that cannot apply leaves the factory paused, with a reason Hermes reads.

## Implementation plan

### Phase 1 — GitHub holds every branch

- `src/repo.ts`:
  - Replace `sync` and `fastForward` with `fetch()`, which runs `git fetch --prune origin`.
  - Add `land(into, message, steps)` and `landAll(...)`, with a temporary worktree under `$FACTORY_HOME/work/land-*` and an atomic push.
  - `merge`, `revertIssueMerge` and `createBranch` work inside `land`.
  - `fetchFromWork` pushes the fetched branch to `origin`.
  - `checkoutBranch` reads only `origin/*`.
- `src/types.ts`: update `HostRepo` to match.
- Callers change from `sync` to `fetch`, and from merge-then-push to `land`: `approval.ts`, `hotfix.ts`, `ship.ts`, `release.ts`, `remove.ts`, `candidate.ts`, `change.ts`, `common.ts`, `design.ts`, `implement.ts`, `testing.ts`, `tick.ts` and `deploy.ts`.
- Tests:
  - `repo.test.ts` runs against a local bare repo standing in for GitHub. It covers a rejected push, a retry, an atomic multi-branch push, and an issue branch that ends up on the remote.
  - The stage fakes in `test-fakes.ts` swap `sync` for `fetch` and `land`.
- Migration: every `fetch()` deletes all local branches of the host clone, so the first tick migrates it. Before the deploy, a check on the server found no local branch ahead of GitHub.

### Phase 2 — Settings in git, secrets on the server

- Add `factory/settings.env` with every key of `infra/server.env` that is not a secret, a committee id or a host path.
- Cut `infra/server.env` down to the rest. It keeps its name and still becomes the server's `factory/.env`.
- `src/config.ts`: read `settings.env` and `.env`, and fail when a key appears in both. Update `.env.example` and `config.test.ts`.
- `factory_infra`: check both files together. The Hermes compose call and `mac/tick-loop.sh` read both.

### Phase 3 — The server updates itself from main

- Add `factory/infra/files/factory-update.sh`. It fetches, compares with `$FACTORY_HOME/deployed`, and pauses with the reason `update`. It waits only for the current run. It refuses local edits, checks out the commit, runs the rebuilds by changed path, records the commit and unpauses. It writes its log to `logs/update.log`, and records a failure in `$FACTORY_HOME/update-failed`, since the state file belongs to the factory's locks. Deploy installs it outside the checkout, so a checkout never rewrites the running script.
- Add `roam-factory-update.service` and `.timer` units. `deploy.py` installs them, stops rsyncing, and turns the existing rsynced dir into a clone once. That step keeps `node_modules`.
- `factory-incidents.sh` prints an update failure.

### Phase 4 — Hermes changes the factory through main

- `src/stages/change.ts`: base the change on `main`, and open the pull request against `main`. Update `prompts/change.md` and `change.test.ts`.
- `hermes/SOUL.md`: change factory code and settings only through `/change`, and never edit `/opt/factory/code` or the env files. An update incident means a hand edit or a failed rebuild.
- `README.md` and `infra/README.md` describe the new flow: push to `main` to deploy, `secrets.env`, and `factory-update`.

## Verification

- `npx vitest run` in `factory/`: every test passes, including the new `repo.test.ts` cases for a rejected push, a retry, an atomic hotfix push and remote issue branches.
- `cd infra && uv run pytest` passes.
- Manual try, positive: push a factory commit to `main` while a job runs. The update waits, then deploys it within one timer period after the job ends. `deployed` names the commit, and the tick runs on it.
- Manual try, positive: approve a card. The merge appears on GitHub `dev`, and the host clone has no local `dev` branch.
- Manual try, negative: edit a file in `/opt/factory/code` by hand. The next update refuses and leaves `update-failed`, and Hermes posts about it. The edit is still there.
- Manual try, negative: make the `main` push fail during a Ship, for example with a temporary branch protection. Ship fails before anything public happens. A retry after the protection is lifted ships cleanly, with no repair by hand.

## Result

Done and deployed on 2026-10-01.

- Checks: factory vitest 305 passed, Hermes plugin pytest 100 passed, infra pytest 11 passed, quality gate passed.
- Switchover: the deploy turned `/opt/factory/code` into a clean clone of main. The first tick deleted every local branch of the host clone, and a check beforehand found none ahead of GitHub.
- Manual try, positive: a docs commit pushed to main was deployed by `factory-update` within 2 minutes, with no pause left behind.
- Manual try, negative: a hand edit in `/opt/factory/code` blocked the next update and wrote `update-failed`. The edit stayed. Removing it let the update deploy.
- Not tried live: a rejected push during Ship. `repo.test.ts` covers a rejected push, its retry and a rejected atomic push against a local stand-in for GitHub.
