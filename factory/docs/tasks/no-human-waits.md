# No failure waits for a person

Status: built, awaiting merge into main
Goal: Every failure in the factory ends with Hermes or an agent fixing it and the work moving on. A person acts only on a product decision: playing and approving a card, Ship, a merge of factory code, secrets, and a major save bump.

## Context

- On 2026-10-07 a member told Hermes to prepare a release. The cut merges `main` into `dev` first, and the merge stopped on conflicts in 18 files. Hermes replied "Please authorize resolving the merge into dev so I can retry the cut." Nobody needed to decide anything. The merge was mechanical work.
- Every failure goes through `reportFailure` in `src/fail.ts`. It adds `factory-stuck`, and only a person or Hermes removes it. Nothing retries.
- An agent already resolves merge conflicts on an issue branch. `prompts/branch-merge.md` drives it, from `src/stages/common.ts` and `src/stages/harden.ts`. Merges between whole branches have no such step: the release cut, hotfix fan-out, Ship, and reverts for Remove. Each throws and stops.
- A failed release cut sets `lastRelease` first, so the next automatic cut waits a full `FACTORY_RELEASE_DAYS`.
- `hermes/SOUL.md` makes Hermes ask before it pushes to `dev`, stop after a second failed fix, and post about load, disk, memory and pauses instead of acting.
- Agents stop a card by writing `.factory/needs-committee.md`. Some prompts use it for mechanical problems, like an image the agent cannot open.
- `resolveActor` in `src/control.ts` matched the sender's Telegram display name against the committee and refused it. Hermes then acted as itself.
- [hermes-autonomy.md](hermes-autonomy.md) gives Hermes the CLI and the authority to move any card. This plan removes the stops that send work back to people.

## Plan

### 1. An agent resolves every branch merge

- When a branch step hits `MergeConflictError`, the step keeps the conflicted merge in a merge clone of the target branch instead of throwing it away.
- It runs the `branch-merge` prompt on that clone. The agent keeps what both sides meant, runs the typecheck and the tests near the conflicted files, and commits.
- The factory checks the result and pushes it through the same atomic push the step already uses. If the target moved meanwhile, the step merges again.
- This covers `bringMainIntoDev` in `src/stages/release.ts`, `mergeEverywhere` in `src/stages/hotfix.ts`, the Ship merge and `takeMain` in `src/stages/ship.ts`, and the reverts in `src/stages/remove.ts`. A revert conflict gets a revert prompt with the same rules.
- `lastRelease` is set only when the cut succeeds, so a failed cut runs again on the next tick after its cause is fixed.
- A change in `main` that the release lacks merges into the release by the same agent. The factory then builds a new candidate. Replaying it stays with the committee, since that is the approval.

### 2. A stuck card is Hermes's work, never a wait

- Every failure goes to Hermes, as the incident watch does now. Hermes fixes the cause, retries with `retry N` and clears the label.
- When a fix fails, Hermes tries a different approach. When a card keeps failing, Hermes sends it back to Design with what it found.
- A post to the committee about a failure reports what Hermes did. It never asks for permission.
- A dev build that fails gets the same treatment. Hermes fixes `dev` or reverts the merge that broke it.
- An approval reply that Hermes did not route in time is routed on Hermes's best reading of it, instead of failing the card.

### 3. SOUL.md says fix it, then report

- Remove "ask the committee before you push to `dev` by hand". Hermes may push a merge to `dev` after the factory checks pass.
- Remove "when the same step fails twice, stop and ask".
- Replace the rules that post instead of acting. Tests that time out under load: Hermes holds new starts until the load falls. Low disk: Hermes cleans what the factory can rebuild. Low memory: Hermes stops the youngest job, which resumes later. A pause someone else wrote: Hermes lifts it once its reason is gone.
- Replace "ask the member for what the error lists" with fetching the missing item again.
- Keep the rules that are product decisions: Ship, nothing on `main` without Ship or a hotfix approval, factory code through a PR, and `.env`.

### 4. Agents do not park cards on mechanical problems

- `needs-committee.md` is for game design forks and a major save bump only. Each prompt says so.
- An image the agent cannot open is fetched again. If it is gone, the agent works from the text and writes down what it could not see.
- A `needs-info` question gets a time limit in `settings.env`. After it, design goes on with the most sensible reading and writes its assumptions into the design comment.

### 5. Permission checks stop blocking Hermes

- The plugin passes the sender's Telegram id with each order, so `resolveActor` finds the member.
- `hermes` may send mechanical orders: route, patch, redesign, retry, cut and merge into `dev`. Orders that need a member stay gated: approve, deny, Ship and Remove.
- Hermes may queue an incident task for itself without a member's message.

## Order

1, then 3, then 5, then 2, then 4. Part 1 fixes the class of failure that stopped today's release. Part 3 is text only and removes most of the asking.

## Tests

- A release cut whose main to dev merge conflicts ends with an agent round and a push to `dev`, with no `factory-stuck` and no failure record.
- The same for a hotfix fan-out, a Ship merge and a Remove revert.
- A failed cut leaves `lastRelease` unchanged.
- An order from `hermes` for route, retry and cut is accepted. An approve from `hermes` is refused.
- A Telegram id sent with an order resolves to its member.
