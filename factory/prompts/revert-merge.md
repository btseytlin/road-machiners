This is a revert round of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{into}}.
The factory takes issue {{issue}} out of this branch. It reverts the merge of that issue.

Read CLAUDE.md first.
Follow it.
Run `npm ci` before anything else. The commit hook needs it.

The revert stopped on conflicts in these files:

{{files}}

Resolve them.
Read both sides with `git log --merge` and `git diff`.
Take out what issue {{issue}} added, and keep everything that later work built on the same lines.
Other work now in this branch stays. Never drop it.
If later work depends on code of issue {{issue}}, keep only the part that work needs.
Run the typecheck and the focused tests near the conflicted files.
Then commit the revert with `git commit --no-edit`.
Do nothing else. Do not touch files the revert did not change, and never add `.github/` files. The factory checks the commit and builds and tests the result after you.
