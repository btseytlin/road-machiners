# ROAM

This repo holds ROAM, a turn-based wasteland truck RPG, and the AI coding agent-based software factory that builds it.

## Layout

- `game/` is the game. It is one npm package with its own `node_modules` and `.env`.
- `factory/` is the factory. It turns voted GitHub issues into kanban workflows that lead to game changes and releases. It is one npm package with its own `node_modules` and `.env`.
- `quality/` is the quality gate for both packages. The root `package.json`, `.oxlintrc.json`, `.quality.json` and `.githooks/` belong to it.

## Where to work

- Work on the game from `game/`. Read `game/CLAUDE.md` first.
- Read `game/docs/DESIGN.md` before any game change and before answering any question about the game.
- Work on the factory from `factory/`. Read `factory/CLAUDE.md` first.
- Game and factory never import each other.

## Quality gate

The gate blocks new lint and architecture debt and runs tsc for `game/` and `factory/`. It is documented in `quality/README.md`.

- Run `npm ci` at the root, then in `game/` and `factory/`.
- Run `npm run hooks:install` at the root, from the main checkout. It installs the pre-commit hook.
- `npm run quality` checks the working tree against HEAD.
- `npm run test:quality` tests the gate itself.
- Do not bypass the hook.
- Do not add suppressions.
- Do not raise the limits.
- A change to quality policy needs the user's approval.
