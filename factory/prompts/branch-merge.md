This is a merge round of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{branch}} of issue {{issue}}.

Read CLAUDE.md first.
Follow it.
Run `npm ci` before anything else. The commit hook needs it.

New commits reached {{branch}} on GitHub while the factory worked on it. A member or another job pushed them.
The factory merged them into your branch, and the merge stopped on conflicts in these files:

{{files}}

Resolve them.
Read both sides with `git log --merge` and `git diff`.
Keep what both sides meant, not just one side.
The newer commits on GitHub are often a member's own fixes. Never drop them.
Run the typecheck and the focused tests near the conflicted files.
Then commit the merge with `git commit --no-edit`.
Do nothing else. The factory checks and tests the branch after you.
