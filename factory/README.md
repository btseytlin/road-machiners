# Game factory

The public files and votes on GitHub issues. Agents design and build the top ones. A human committee approves each result by playing it, and approved work ships to itch.io as a weekly release. Hermes, a chat agent, manages the factory and handles its failures.

## Docs

- [docs/process.md](docs/process.md) is the spec, with a diagram of each flow. Read it first.
- [docs/state.md](docs/state.md) describes all factory state as one model: the stores, card positions, queues and the commands that change them.
- [docs/stages.md](docs/stages.md) holds the rules of each stage, model routing and reference images.
- [docs/evidence.md](docs/evidence.md) covers screenshots, the visual review and ad hoc files.
- [docs/operations.md](docs/operations.md) covers queues, CPU pools, the daily cap, resume, cleanup, failures, the ledger and deploys.
- [hermes/SOUL.md](hermes/SOUL.md) is Hermes's identity and rules.
- [infra/README.md](infra/README.md) sets up the server. [mac/README.md](mac/README.md) runs the factory on a Mac. [dashboard/README.md](dashboard/README.md) covers the public dashboard.

## Settings

Run every command in this file from `factory/`. The factory reads two files.

- `settings.env` is tracked and holds the limits, the models and the timeouts. Change it through a pull request to `main`.
- `.env` holds the secrets, the committee ids and the host paths, and never leaves its host. Copy `.env.example` to `.env` first.
- A key in both files stops the factory.

## Committee

- The committee is a whitelist in `$FACTORY_HOME/committee/committee.json`. Each member has a Telegram id, a GitHub login and a name.
- Until that file exists, the committee is one member from `FACTORY_COMMITTEE_BOOTSTRAP` and `FACTORY_COMMITTEE_BOOTSTRAP_GITHUB` in `.env`.
- Members manage the list in the chat with `/committee list`, `/committee add`, `/committee remove` and `/committee github`. The Hermes plugin writes the file.
- The bot answers committee members only.

## GitHub setup

- The host needs `gh` logged in with the `repo`, `project` and `read:org` scopes. Run `gh auth setup-git` so git pushes with it.
- The host needs a git identity, since approvals make merge commits.
- Make a GitHub Project for the repo. Its Status field needs the options Triage, Design, Implementation, Testing, Approval, Hardening and Done. Put its owner and number in `settings.env`.
- The repo needs a `dev` branch.

## Parts

- `src/` holds the Node CLI. `npm run factory -- tick` runs one tick, and `npm run factory -- run <stage> <issue|->` runs one job.
- `prompts/` holds the prompt of each agent stage.
- `docker/` holds the agent image with Blender and ffmpeg, the egress proxy and the vendored `blender-image-to-3d` skill. `FACTORY_SMOKE_IMAGE=<image> npx vitest run agent-image` checks that Claude reads a mounted image's pixels in the built image.
- `hermes/` holds the Hermes compose file, config, identity, incident watch, the `factory-host` ssh command and the chat plugin.
- `src/dashboard/` and `dashboard/` hold the read-only public dashboard.
- `infra/` deploys the server with pyinfra. `mac/` runs the factory on a Mac.

## Tests

- `npm test` runs the CLI tests. `npm run typecheck` runs tsc.
- `uv run --with pytest --with pyyaml pytest hermes` runs the Hermes plugin tests.
- `cd infra && uv run pytest` runs the infra helper tests.
