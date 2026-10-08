# The game suite runs once per card, before the merge

**Status:** done
**Superseded by:** [trusted-agent-flow.md](trusted-agent-flow.md). The suite now runs at the merge checkpoint of the merge queue, not in Hardening.
**Branch:** check-junctions
**Worktree:** .worktrees/check-junctions
**Mode:** interactive

## Context
- The checks job runs the full game suite before every committee post, after every patch, after hardening whenever the head moved, and after every conflict resolve. [suite-reruns.md](suite-reruns.md) has the counts.
- The committee preview only needs a build that starts and plays. The suite matters only for what merges.
- [check-gates.md](check-gates.md) holds the full redesign with fix rounds and a merge-with-base job. It stays out of scope here.

## Desired design
The checks job runs at two junctions only.
- Preview junction: a card in Testing that is not approved yet runs npm ci, the typecheck, the playtest and the build. The suite does not run. This covers verify and patch.
- Merge junction: an approved card in Hardening runs the full checks with the cached suite, every time, before its merge queues. This covers the harden round and the conflict resolve.
- A hotfix merges straight from its post, so its preview runs the full checks.
- Docs-only builds and the post phase stay as they are. Fix rounds stay as they are and rerun the script of their own junction.
- The release playtest keeps its own checks.

## Invariants and principles
- No commit merges into a base without a passing full suite on that commit. Check: harden always sets phase `checks`, and approve only merges from Hardening or a hotfix.
- The junction comes from the card's state, not from a new flag. Approved or hotfix means the merge junction.

## Implementation plan
### Phase 1 — preview script and junction choice
- `src/stages/checks.ts`: add `previewScript(playtest)`, the checkScript without the suite step. `runChecks` picks `checkScript` when `approvedAlready(...) !== null` or the base is `HOTFIX_BASE`, and `previewScript` otherwise.
- Tests in `src/stages/checks.test.ts`: a preview card runs no suite, an approved card and a hotfix run the suite.
### Phase 2 — Hardening always checks
- `src/stages/harden.ts`: drop the head equals build skip. After the review the card always goes to phase `checks`.
- `src/stages/approval.ts`: the approve comment drops "the checks only if they change the code".
- Update `src/stages/harden.test.ts` for the removed skip.
- `docs/stages.md`: rewrite the Checks and Hardening lines to the two junctions.

## Verification
- Run the touched factory test files, then the full factory suite and tsc.
- Manual try, positive: render both scripts and confirm only the merge script holds `test:cached`.
- Manual try, negative: a hardened card whose head equals its build still gets phase `checks`.

## Result
- The preview checks run npm ci, the typecheck, the playtest and the build, with no game suite. The merge checks in Hardening and a hotfix's checks run the cached suite too.
- Hardening always runs the checks, even when the head is still the played build.
- Factory suite: 1077 passed, tsc clean, quality hook passed.
- Not yet seen on the server. The first preview and Hardening checks after deploy show it.
