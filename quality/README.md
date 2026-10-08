# Quality checks

The pre-commit gate blocks new JavaScript and TypeScript debt without requiring a cleanup of existing code. It checks the Git index, so unstaged fixes cannot hide errors in a commit. It never formats, stages, stashes, or changes source files.

## Setup and use

From the main checkout:

```sh
npm ci
npm run hooks:install
```

The installer sets the repository-local `core.hooksPath` to `.githooks`. It refuses to replace another configured hooks directory or hide an existing `.git/hooks/pre-commit`. Hook configuration is shared by worktrees, so install from the main checkout after merging the hook files. Each worktree needs its own `npm ci` at the root, and in `game/` and `factory/` for the type checks.

```sh
npm run quality
npm run test:quality
git add <files>
git commit
```

`npm run quality` checks tracked and untracked source files in the working tree against HEAD. The pre-commit hook checks the full staged source tree against HEAD. Both run the full TypeScript check for `game/tsconfig.json` and `factory/tsconfig.json`. A new repository with no HEAD treats every file as new.

The hook exports the index to a temporary directory under `tmp/` and removes it when the check finishes. Dependencies come from this checkout. The snapshot links `game/node_modules` and `factory/node_modules` to the real ones. Stage changes to `.oxlintrc.json`, `.quality.json`, `package.json`, `package-lock.json`, `quality/quality.mjs` and `quality/quality-policy.mjs` together. The hook refuses unstaged changes to those files.

## Enforced rules

- Oxlint correctness rules, explicit `any`, type-only import style, and debugger statements.
- Cyclomatic complexity at most 6, nesting at most 4, function length at most 300 code lines, and file length at most 1,000 code lines. Blank lines and comments do not count toward length. Tests are exempt from these structural limits, but still get correctness checks and type checks.
- Static imports in `game/src/sim/` must not depend on Three.js, Rapier, rendering, physics, UI, or audio.
- New lint-disable comments, `@ts-ignore`, and `@ts-nocheck` are rejected. Quoted examples in strings are not suppression comments.
- Source files hold no comments except a module docstring: comments before the first statement, at most `maxDocstringLines` lines. A `//` inside a string is not a comment.
- Fragmentation follows the Steelman rule: at most 5 production source files per 1,000 code lines for a new component. Each immediate `game/src/` subdirectory, including its descendants, is a component. Files directly in `game/src/` form a separate component. Tests and comment-only files do not count. An existing component is checked only when its file count grows, against the higher of 5 or its previous ratio.
- No text file may hold the middle dot separator, U+00B7. Use a comma or a colon instead. Git grep finds it in every tracked text file, and in untracked ones for `npm run quality`. Binary files and the folders the gate ignores, like `.claude/` with its vendored skills, are skipped. This is a fixed ban with no debt allowance.
- `tsc` must pass for the complete source tree selected by `game/tsconfig.json` and by `factory/tsconfig.json`. Type errors have no debt allowance.

Lint debt is compared by file, rule, and diagnostic message, without line numbers. Structural diagnostics also compare the measured size, so reducing an over-limit function passes. The check rejects new findings, extra copies of an existing finding, and larger structural measurements. It does not prove that each existing defect stayed at the same location. Renaming a file gives it no old debt allowance. Each successful commit becomes the next baseline, so removed debt cannot return for free.

`.oxlintrc.json` owns lint rules and structural limits. `.quality.json` owns the fragmentation ceiling and the docstring line limit. `quality/quality-policy.mjs` owns source inspection, the comment ban, fragmentation and the separator ban. `quality/quality.mjs` owns staged snapshots, debt comparison, and type checking. Do not weaken policy or add bypasses to get a commit through. Policy changes require user approval.

## Port scope

Adapted from [Steelman-Labs/.github](https://github.com/Steelman-Labs/.github/tree/62202092e1551b2cf787003d0e083cd984e0ff84), including the structural limits and fragmentation rule. Oxlint replaces Ruff, and `tsc` replaces ty. Oxlint parses TypeScript independently of the compiler version.

The port does not copy Python formatting, org policy sync, paid semantic reviews, or the manual duplicate-code scan. Unit tests and browser checks remain separate commands as required by [project guidance](../game/CLAUDE.md). This is a local Git hook, not a CI gate. Git allows hooks to be bypassed, so the hook is an agent quality check, not a security boundary.
