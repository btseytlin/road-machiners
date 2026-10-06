# Game factory

The factory turns voted GitHub issues into game changes and releases. Agents design, build and test each issue, and a human committee approves the result by playing it.

Read [docs/process.md](docs/process.md) before any factory change and before answering any question about the factory. It is the spec, and it says how to keep its diagrams in step with the code. [README](README.md) lists the other docs.

## Commands

Run these from `factory/`. Run `npm ci` first.

- `npm test` runs the CLI tests.
- `npm run typecheck` runs tsc.
- `npm run diagrams` renders the process diagrams.
- `npm run factory -- tick` runs one tick. The server runs it on a timer.
- `uv run --with pytest --with pyyaml pytest hermes` runs the Hermes plugin tests.
- `cd infra && uv run pytest` runs the infra helper tests.

## Layout

- `src/` holds the Node CLI. `src/tick.ts` picks and starts jobs, `src/job.ts` runs one, and `src/stages/` holds each stage.
- `prompts/` holds the prompt of each agent stage.
- `docker/` holds the agent image.
- `hermes/` holds Hermes, the agent that manages the factory, with its config, identity, incident watch and chat plugin.
- `infra/` deploys the server with pyinfra. `mac/` runs the factory on a Mac.

## Rules

- `settings.env` is tracked and holds limits, models and timeouts. `.env` holds secrets, committee ids and host paths, and never leaves its host. A key in both files stops the factory.
- The server runs only GitHub's `main`. Factory changes reach it by a merge into `main`, never by a hand edit on the server.
- GitHub holds every branch. Each git step runs in a throwaway worktree under a lock and pushes at once. A conflict or rejected push must leave GitHub and the host as they were.
- Branch moves that go together, like a ship or a hotfix, go to GitHub in one atomic push.
- An agent's work reaches GitHub only after the factory checks its diff. Only `butler push` on the host gets `BUTLER_API_KEY`.
- Jobs share the host clone and the state file, so every state update runs under its lock.
- Hermes's SOUL.md repeats no process detail. It points to `docs/process.md` and `docs/state.md`.
- A change to factory state, like a new state field, queue or card position, updates `docs/state.md`, `src/position.ts` and the `factory` CLI in `src/ctl.ts` in the same commit.
- The factory never imports game code.
