# Game factory

Status: executing
Branch: game-factory
Worktree: .worktrees/game-factory
Goal: On the Mac as the server, a voted issue in a sandbox GitHub repo moves through design, build and deploy to a committee Telegram post, an approve reply merges it to `dev` and redeploys `/dev`, and a release run merges `dev` to `main`. Confirming the full goal needs a real Telegram bot, the `project` gh scope and later the real server.
Mode: hands-off

## Context

- This task owns the stage flow and the contracts between parts. The part tasks are [intake](factory-intake.md), [design stage](factory-design-stage.md), [build stage](factory-build-stage.md), [hosting](factory-hosting.md), [approval](factory-approval.md), [release](factory-release.md), [maintenance](factory-maintenance.md), [factory chat](factory-chat.md) and [CPU playtest](playtest-cpu-mode.md). Their designs live here, so each contract has one home.
- The game stays at the repo root. All factory code, prompts and config go in `factory/`. Tunable numbers go in `.env` and `.env.example`.
- Hermes Agent by Nous Research is the orchestrator. Its gateway runs cron jobs every minute and talks to Telegram. A cron job with `--no-agent` runs a script from `$HERMES_HOME/scripts/` without an LLM. Scripts time out after one hour by default.
- A Hermes plugin hook, `pre_gateway_dispatch`, sees every inbound message with sender id, chat id and text before auth and the agent. It can skip the message, so commands never reach the LLM. Plugin slash commands get no sender id.
- Hermes drops Telegram button presses with unknown callback prefixes. A reply to a bot post needs no adapter change.
- The up skills exist only in Claude Code. `claude -p` runs them headless. The user will provide a subscription OAuth token from `claude setup-token`. The user accepts that hostile issue text could leak it.
- Hermes can route its own chat model through Claude Code credentials, but that path bills only extra usage on Max plans.
- Docker 29 runs on the Mac. The playwright image runs Chromium with software drawing, like the server will.
- `gh` is logged in as btseytlin with `repo` and `workflow` scopes. GitHub Projects need the `project` scope, which is missing.
- The ultrapack plugin installs from the public repo `btseytlin/ultrapack`.
- The save key is `roam.save` in `src/three/save.ts`. Tips use `roam.tips`. The Vite base is relative, so a build runs from any folder.
- `scripts/playtest.mjs` launches Chromium with Metal flags and fails under 50 fps.
- `npm run itch` builds the last commit in a clean worktree and uploads it with butler.
- No `dev` branch exists yet.

## Design

The factory is a Node CLI in `factory/`, run on the host. Hermes only triggers it. Every agent runs in a Docker container that holds the work clone and the OAuth token, and nothing else. The host step around each container holds GitHub, Telegram and deploy rights.

### Runtime

- `factory tick` is the one entry point. A systemd timer runs it every `FACTORY_TICK_MINUTES` on the server. On the Mac a loop script runs it.
- Hermes runs in Docker, like `Steelman/infrobot`, and owns Telegram chat. It cannot start agent containers, since that needs the Docker socket, which is root on the host. So the host timer runs the tick, not a Hermes cron job.
- A tick checks the running job first. A job past the time limit of its queue, like `FACTORY_DESIGN_TIMEOUT_MINUTES`, is killed and reported as failed. A running job ends the tick.
- A factory update builds each commit in its own release folder and swaps a link, so running jobs finish on their code and the update never waits for them. A job whose process dies resumes once with its agents' sessions. See `deploy-job-continuity.md`.
- A tick then runs intake, then starts at most one job. Release is due every `FACTORY_RELEASE_DAYS`, and maintenance every `FACTORY_MAINTENANCE_HOURS`. Due periodic jobs start first. Otherwise the card furthest along starts: testing, then implementation, then design.
- A job runs as a detached `factory run <stage> <issue>` process with a pid file and a log in `$FACTORY_HOME/logs/`. The tick stays short, so the Hermes script timeout never matters.
- The Hermes plugin writes each committee command as a JSON file into `$FACTORY_HOME/inbox/`. The tick drains the inbox first and answers in the chat through the Bot API.
- An approve reply and a `/change` request only queue work in local state. The next tick runs them as jobs before any other, so the host clone never serves two jobs at once. Feedback touches only GitHub, so it runs at once.
- Local state lives in `$FACTORY_HOME/state/state.json`: the running job, approval post ids and the last release and maintenance times. It is written to a temp file and renamed.
- The kanban column is the stage state of each card. Local state holds only what GitHub cannot.

### Kanban and names

- The GitHub Project has a Status field with Design, Implementation, Testing, Approval and Done.
- Issue N works on branch `factory/issue-N` with the task file `docs/tasks/issue-N.md`.
- The label `factory-stuck` marks a failed card. The tick skips it until a human removes the label. Nothing retries on its own.
- The label `wont-do` marks a refused issue.

### Intake

- Open issues with `feature-request` or `bug` are candidates.
- A candidate is marked when it is older than `FACTORY_MIN_AGE_HOURS` and has `FACTORY_MIN_VOTES` thumbs-up, or one thumbs-up from a login in `FACTORY_COMMITTEE_GITHUB`.
- A marked issue not yet on the board goes to Design.
- The rule is a pure function, tested apart from GitHub.

### Agent container

- `factory/docker/Dockerfile` builds from the Playwright image. It adds git, Claude Code and the ultrapack plugin, and runs as a non-root user.
- A container mounts the work clone at `$FACTORY_HOME/work/issue-N` and the shared npm cache. Its secrets are `CLAUDE_CODE_OAUTH_TOKEN` and `ELEVENLABS_API_KEY`.
- The work clone is a plain clone, not a worktree, so its git data lives inside the mount.
- The agent commits on the task branch. It writes messages for the host into `.factory/` in the clone, which git ignores.
- The host never runs git hooks or npm scripts inside a work clone. It fetches the branch into its own clone and pushes from there.
- Tests, the CPU playtest and branch builds also run in the container, since the branch code is agent-written.

### Stages

1. Design runs Opus 5.5 with `factory/prompts/design.md`. Issue text and comments go in as a file marked untrusted. The agent runs up:udesign and up:uplan in hands-off mode on `docs/tasks/issue-N.md`. It may write `.factory/wont-do.md` instead. The host checks that the task file has a Plan, pushes the branch and moves the card to Implementation. On won't-do it comments the reason, labels the issue and moves the card to Done.
2. Implementation runs Sonnet 5.5 with `factory/prompts/implement.md`. The agent runs up:uexecute. The host checks for new commits, pushes and moves the card to Testing.
3. Testing runs Sonnet 5.5 with `factory/prompts/test.md`. The agent runs up:uverify. A blocking review follows, as the README describes. It writes `.factory/approval.json` with a short description and how to try it, and `.factory/screenshot.png` of the core feature. Then the host runs `npm test`, `npm run typecheck` and the CPU playtest in a fresh container. Agent claims do not count as passing.
4. Deploy builds the branch in a container with `SAVE_SCOPE` set to the short commit hash. The host copies `dist/` to `$FACTORY_WEB_ROOT/<hash>/`.
5. Approval posts the screenshot, play link, issue link, description and how to try it to `FACTORY_COMMITTEE_CHAT`. The card moves to Approval, and state keeps the post id.
6. An approve reply to that post from a committee member merges the branch into `dev` with a merge commit named after the issue. The host pushes `dev`, rebuilds it with `SAVE_SCOPE=dev` into `/dev`, closes the issue and moves the card to Done.
7. Any other reply from a committee member is feedback. The host comments it on the issue under a fixed heading and moves the card to Design. Design reads the issue comments, so it revises the task file on the same branch.

### Stops

- Any stage error labels the card `factory-stuck` and posts one message to the committee chat. It names the stage, the issue, the error and the log path.
- The host fails a stage whose diff changes `SAVE_MAJOR` in `src/three/save-migrations.ts`. The committee post asks for a decision. The agent may also stop early with `.factory/needs-committee.md`.
- A merge conflict into `dev` fails the approval step the same way.
- Missing config fails the CLI at start.

### Telegram

- The host sends posts through the Bot API with `TELEGRAM_BOT_TOKEN`. It is the same bot Hermes uses. Sending does not disturb Hermes polling.
- `factory/hermes/plugin/` holds a Hermes plugin. Its `pre_gateway_dispatch` hook handles messages in the committee chat from ids in `FACTORY_COMMITTEE_TELEGRAM`. A reply to an approval post queues an approve or feedback command. A message starting with `/change` queues a change request. It skips these messages, so they never reach the LLM. Everything else goes to Hermes as normal chat.
- The Hermes container mounts only the inbox, read-write, and the state folder, read-only. It holds no GitHub or deploy credential.
- Approval uses a reply, not a button, since Hermes has no hook for new button types.

### Hosting

- A build reads `SAVE_SCOPE` at build time through a Vite define. Empty gives the key `roam.save`, so itch players keep their saves. A scope gives `roam.save.<scope>`. Tips and sound settings stay shared.
- `FACTORY_WEB_ROOT` is a plain folder. On the Mac any static server serves it. `FACTORY_PUBLIC_URL` is the base of play links. The real server and domain come later.

### Release

- The release job lists merge commits on `dev` since `main` as the changelog. Each names its issue.
- Sonnet writes a short description from that list in a container. The screenshot comes from a CPU playtest of `dev`.
- The host merges `dev` into `main` and pushes. The agent container builds `main`, and the host uploads only `game/dist` with butler. Then it posts the screenshot, description and changelog to `FACTORY_PUBLIC_CHANNEL`.
- An empty changelog skips the release and records the time.

### Maintenance

- The maintenance job opens an issue titled with the date and labeled `maintenance`. Sonnet runs `factory/prompts/maintenance.md`. It picks one slow spot, code quality issue or stale doc and writes a task file with a Plan for that issue.
- The host retitles the issue from `.factory/issue.md` and puts the card in Implementation. From there it flows like any task.
- An agent that finds nothing writes `.factory/nothing.md`. The host closes the issue.

### Triage

- The board has a Triage column before Design. Intake puts voted issues there.
- The triage stage runs Sonnet 5.5 in the agent container with `factory/prompts/triage.md`. The prompt holds a rubric: a clear goal, a result a player can check, a sane scope and a fit with DESIGN.md. The agent writes `.factory/triage.json` with a verdict `ready`, `unclear` or `wont-do`, a short reason and, for `unclear`, the questions.
- `ready` moves the card to Design. `wont-do` comments the reason, labels `wont-do`, closes the issue and moves the card to Done.
- `unclear` comments the questions to the author, labels the issue `needs-info` and leaves the card in Triage. The tick skips cards with that label.
- Every factory comment ends with a hidden marker, since factory comments post from the same GitHub account as a member. Each tick, a `needs-info` issue with a comment without the marker after the last factory question loses the label, and triage runs again with the answers.
- Design may send a card back to Triage with `.factory/questions.md`, only for a genuine blocker. Trying and taking feedback at approval comes first.
- Triage runs in the container, not in Hermes. Issue text is untrusted, and Hermes holds committee powers.

### Ad hoc tasks

- A committee member asks Hermes for one-off work in plain words, like "simulate 10 battles and tell me if the MG is too weak".
- Hermes queues it with the plugin tool `factory_queue_task`. The tool writes an `adhoc` inbox command with the request, the member and the chat message to answer.
- The tick opens a GitHub issue labeled `adhoc` for it and puts the card in Implementation. Each request is its own issue, so a new one never replaces an old one. They run oldest first, after queued approvals and changes.
- The `adhoc` job runs Sonnet 5.5 in a fresh clone of `dev` with `factory/prompts/adhoc.md`. It may run any repo harness, like `npm run combat`. It writes `.factory/report.md`. Nothing is pushed.
- The host posts the report as a reply to the member's message, comments it on the issue, closes the issue and moves the card to Done.

### Factory chat

- `factory change "<text>"` clones `dev` and runs Sonnet with `factory/prompts/change.md`. The host checks that the diff touches only `factory/`, pushes a branch and opens a pull request against `dev`. It never merges.
- Hermes chat about anything else uses whatever model the user sets in Hermes.

### CPU playtest

- `npm run playtest -- --cpu` launches Chromium without the Metal flags and skips the FPS check. It still fails on page errors and the crash screen, and still reports fps.

### Setup and testing on the Mac

- `factory/README.md` covers setup: the `.env` keys, the Docker image, the Hermes plugin and cron install, and the web root.
- `factory/infra/` is a pyinfra project in the style of `Steelman/infra`. `provision.py` sets up a Linux host: packages, Docker, Node, gh, firewall and the factory user. `deploy.py` syncs the code, builds the agent image, pushes the env file, installs the tick timer and starts Hermes and Caddy with Docker Compose. Caddy serves the web root with TLS. `status.py` reads facts only.
- On the Mac, Hermes runs from the same compose file, and `factory/mac/tick-loop.sh` runs the tick.
- A private sandbox repo under btseytlin holds a copy of the game for end-to-end runs. The factory reads its repo from `FACTORY_REPO`.

Backward compatibility: saves on itch keep `roam.save`. Nothing else has consumers.

TDD: yes for the pure rules: intake marking, the tick choice, reply parsing, the save key and the SAVE_MAJOR check. The GitHub, Docker and Telegram wrappers get tests against a fake command runner. End-to-end runs cover the rest.

### Invariants

- IV10 — Agent and build containers reach only the allowlisted hosts through the egress proxy, unless their issue has the `open-network` label.
- IV11 — No agent branch reaching GitHub carries `.github/`, `.factory` or `.factory-tasks` paths.
- IV12 — Public-driven agent jobs stay within `FACTORY_MAX_JOBS_PER_DAY` in any 24 hours.

- IV1 — An agent container gets only its work clone, the npm cache, `CLAUDE_CODE_OAUTH_TOKEN` and `ELEVENLABS_API_KEY`. No GitHub, Telegram or butler credential enters it.
- IV2 — The host runs no git hook, npm script or build from any clone. Builds run in the agent container, and the host only copies or uploads their output.
- IV3 — At most one job runs at a time. A job past the timeout is killed and reported.
- IV4 — A failed or stalled stage labels its card `factory-stuck` and posts once. No stage retries on its own.
- IV5 — Only committee Telegram ids can approve, give feedback or request a change. Only committee GitHub logins count as a committee vote.
- IV6 — A change pull request touches only `factory/` and is never merged by the factory.
- IV7 — A build with no `SAVE_SCOPE` uses the save key `roam.save`.
- IV8 — A diff that changes `SAVE_MAJOR` never reaches approval.
- IV9 — Missing required config stops the CLI before any action.

### Principles

- PC1 — Every post and log line names the issue number and stage, so a stuck card is traceable from the chat to the log.
- PC2 — The host checks results itself. Agent reports feed the approval post but never pass a gate.

### Assumptions

- AS1 — `claude -p` with `CLAUDE_CODE_OAUTH_TOKEN` runs the ultrapack skills in a Linux container.
- AS2 — The game's tests and the playtest pass in the Playwright Linux image with software drawing.
- AS3 — The Hermes plugin API and `pre_gateway_dispatch` behave as the current Hermes docs say.
- AS4 — Sending through the Bot API while Hermes polls the same bot works.

### Unknowns

- UK1 — The server domain and web server. Deferred to the user.
- UK2 — The stage timeout and tick interval values.
- UK3 — Which model Hermes uses for chat. Infrobot uses Codex OAuth. The factory config starts with Anthropic, and the user confirms.

## Plan

Approach: PH1 writes the shared types and core helpers inline, so every later phase codes against real signatures. PH2 to PH8 then run in parallel on disjoint paths. PH9 wires the CLI, config files and docs. The host code is TypeScript run by `vite-node`, like the other repo scripts. Code follows the quality limits: complexity 6, nesting 4.

### PH1 — Core (inline)
- 1.1 `factory/src/types.ts` (create) — `FactoryConfig`, `Run`, `RunResult`, `Issue`, `Card`, `Column`, `FactoryState`, `Job`, `GitHub`, `Telegram`, `Container`, `HostRepo`, `Ctx`. Respects IV9.
- 1.2 `factory/src/config.ts` (create) — `loadConfig(env): FactoryConfig`. Throws naming every missing key. Respects IV9.
- 1.3 `factory/src/exec.ts` (create) — `realRun: Run` over `child_process.spawn`, and `must(result, what)` that throws on a nonzero exit.
- 1.4 `factory/src/state.ts` (create) — `readState(path)`, `writeState(path, state)` by temp file and rename.
- 1.5 `factory/src/fail.ts` (create) — `reportFailure(ctx, stage, issue, error, log)`: labels the card `factory-stuck` and posts once. Respects IV4, PC1.
- 1.6 `tsconfig.json`, `vitest.config.ts`, `package.json` (modify) — include `factory/src`, add `@types/node`, add `"factory": "vite-node factory/src/cli.ts"`.
- Commit: Factory core types, config and helpers

### PH2 — GitHub and intake
- 2.1 `factory/src/github.ts` (create) — `ghClient(run, cfg): GitHub` over the `gh` CLI and GraphQL for the Project Status field.
- 2.2 `factory/src/intake.ts` (create) — pure `isMarked(issue, now, rules)`, command `intake(ctx)`.
- Tests with a fake `Run`. Respects IV5.
- Commit: Intake marks voted issues and adds them to the board

### PH3 — Telegram and Hermes plugin
- 3.1 `factory/src/telegram.ts` (create) — `botClient(token, fetch): Telegram` with `sendPhoto` and `sendMessage` returning message ids.
- 3.2 `factory/hermes/plugin/` (create) — `plugin.yaml`, `__init__.py`: the `pre_gateway_dispatch` hook, pure `route(text, reply_to, user_id, cfg)` and a pytest for it. Respects IV5.
- 3.3 `factory/hermes/factory-tick.sh`, `factory/hermes/install.sh` (create).
- Commit: Telegram posts and the Hermes plugin for committee replies

### PH4 — Container, host repo and deploy
- 4.1 `factory/docker/Dockerfile` (create) — Playwright base, git, Claude Code, ultrapack plugin, non-root user. Respects IV1.
- 4.2 `factory/src/container.ts` (create) — `dockerContainer(run, cfg): Container` with `agent()` and `shell()`. Respects IV1.
- 4.3 `factory/src/repo.ts` (create) — `hostRepo(run, cfg): HostRepo` and `prepareWorkClone()`. Git runs with `core.hooksPath=/dev/null`. Respects IV2.
- 4.4 `factory/src/deploy.ts` (create) — `buildAndDeploy(ctx, clone, scope): string` returning the play URL.
- Commit: Agent containers, host repo and deploys

### PH5 — Tick and jobs
- 5.1 `factory/src/tick.ts` (create) — pure `chooseJob(state, cards, now, cfg)`, command `tick(ctx)`. Respects IV3.
- 5.2 `factory/src/jobs.ts` (create) — `spawnJob`, `isAlive`, `killJob`.
- Commit: Tick picks one job at a time and stops stalled jobs

### PH6 — Card stages
- 6.1 `factory/src/stages/design.ts`, `implement.ts`, `testing.ts`, `approval.ts` (create). Respects IV4, IV8, PC2.
- 6.2 `factory/src/save-guard.ts` (create) — pure `changesSaveMajor(diff)`. Respects IV8.
- 6.3 `factory/prompts/design.md`, `implement.md`, `test.md` (create).
- Commit: Design, implementation, testing and approval stages

### PH7 — Periodic stages and chat
- 7.1 `factory/src/stages/release.ts`, `maintenance.ts`, `change.ts` (create). Respects IV6.
- 7.2 `factory/prompts/release.md`, `maintenance.md`, `change.md` (create).
- Commit: Release, maintenance and factory change requests

### PH8 — Game: save scope and CPU playtest
- 8.1 `src/three/save.ts:8` (modify) — `saveKey(scope)` pure, `SAVE_KEY` from `__SAVE_SCOPE__`. Respects IV7.
- 8.2 `vite.config.ts`, `vitest.config.ts` (modify) — define `__SAVE_SCOPE__` from `process.env.SAVE_SCOPE`.
- 8.3 `scripts/playtest.mjs` (modify) — `--cpu` flag.
- 8.4 `CLAUDE.md` (modify) — playtest `--cpu` and `SAVE_SCOPE` lines.
- Commit: Builds take a save scope, and the playtest has a CPU mode

### PH9 — CLI, config and docs (inline)
- 9.1 `factory/src/cli.ts` (create) — `tick`, `run <stage> <issue>`, `approve`, `feedback`, `change`, `intake`.
- 9.2 `.env.example`, `.gitignore` (modify) — factory keys, `.factory/`.
- 9.3 `factory/README.md` (create) — setup on the Mac and a server.
- Commit: Factory CLI and setup docs

### Test strategy
- Pure rules test first: `isMarked`, `chooseJob`, `route`, `saveKey`, `changesSaveMajor`, `loadConfig`.
- Wrappers test against a fake `Run` that records calls.
- End to end on the Mac with a sandbox repo, in verify.

### Order & dependencies
- PH1 blocks all others through IF1. PH2 to PH8 run in one wave. PH9 follows.

### Risks / rollback
- RK1 — AS1 fails and the up skills do not load headless in the container. Verify runs one container agent early.
- RK2 — Game tests fail in the Linux image. Verify runs `npm test` in the container before stage runs.

### Interfaces
- IF1 [blocks] — `factory/src/types.ts` exports every shared type. Stages need the real file to typecheck.
- IF2 — `Ctx` fields: `cfg`, `run`, `github`, `telegram`, `container`, `repo`, `statePath`, `log(stage, issue, msg)`.
- IF3 — stage functions: `runStage(ctx, issue): Promise<void>` per card stage, and `approve(ctx, issue, by)`, `feedback(ctx, issue, by, text)`, `release(ctx)`, `maintenance(ctx)`, `change(ctx, text, by)`.
- IF4 — agent output files in `.factory/`: `wont-do.md`, `needs-committee.md`, `approval.json` `{description, howToTry}`, `screenshot.png`, `issue.md`, `nothing.md`.

### Interface graph
- PH1 -> IF1, IF2 @ factory/src/types.ts, factory/src/config.ts, factory/src/exec.ts, factory/src/state.ts, factory/src/fail.ts, tsconfig.json, vitest.config.ts, package.json, package-lock.json
- PH2 IF1 -> @ factory/src/github.ts, factory/src/intake.ts
- PH3 IF1 -> @ factory/src/telegram.ts, factory/hermes/
- PH4 IF1 -> @ factory/docker/, factory/src/container.ts, factory/src/repo.ts, factory/src/deploy.ts
- PH5 IF1, IF3 -> @ factory/src/tick.ts, factory/src/jobs.ts
- PH6 IF1, IF2, IF4 -> IF3 @ factory/src/stages/design.ts, factory/src/stages/implement.ts, factory/src/stages/testing.ts, factory/src/stages/approval.ts, factory/src/save-guard.ts, factory/prompts/design.md, factory/prompts/implement.md, factory/prompts/test.md
- PH7 IF1, IF2, IF4 -> IF3 @ factory/src/stages/release.ts, factory/src/stages/maintenance.ts, factory/src/stages/change.ts, factory/prompts/release.md, factory/prompts/maintenance.md, factory/prompts/change.md
- PH8 -> @ src/three/save.ts, vite.config.ts, vitest.config.ts, scripts/playtest.mjs, CLAUDE.md
- PH9 IF3 -> @ factory/src/cli.ts, .env.example, .gitignore, factory/README.md

## Verify
## Code smells
## Conclusion
### Hands-off decisions

- make: size Large, full flow — nine parts and new infrastructure.
- make: one task file drives all nine parts — the contracts need one home, and separate plans would repeat them.
- make: branch `game-factory` in `.worktrees/game-factory`, already made before hands-off started.
- udesign: triage in the Sonnet container, not Hermes — issue text is untrusted and Hermes holds committee powers; user agreed.
- udesign: Hermes in Docker and a systemd tick timer — user pointed at Steelman/infrobot and Steelman/infra; a Hermes container cannot run agent containers without root-level Docker access.
- udesign: pyinfra deploy in `factory/infra/` — user asked for pyinfra like Steelman/infra.
- make: pushing to a private sandbox repo is allowed — the user authorized a temp repo. Nothing is pushed to `origin`.
- udesign: agents run in Docker containers — the user required agents without secrets, and the container matches the CPU server.
- udesign: host fetches from work clones and never runs their hooks — an agent could plant a hook that runs with host credentials.
- udesign: approval by reply, not button — Hermes has no hook for new button types.
- udesign: `dev` rebuilds and change pull requests target `dev` — one flow for all code into `main`.
- udesign: one job at a time, furthest card first — one server, and slow is fine.
- udesign: maintenance period in hours from `.env` — the user said once a day, and the number belongs in `.env`.
- uplan: plan auto-approved (hands-off).

### Deferred (needs user input)

- Real Telegram bot token, committee chat, public channel and member ids — needed for the Telegram half of the goal.
- `gh auth refresh -s project` — Projects need that scope, and it opens a browser.
- `claude setup-token` for `CLAUDE_CODE_OAUTH_TOKEN` — interactive login.
- Server, domain and web server config — the user will provide them at the end.
- Stage timeout and tick interval — no value was given. `.env.example` needs numbers for a first run.
