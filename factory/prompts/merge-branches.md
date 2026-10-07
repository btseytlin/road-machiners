This is a merge round of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{into}}.
The factory merges branch {{branch}} into it, for this reason: {{reason}}

Read CLAUDE.md first.
Follow it.
Run `npm ci` before anything else. The commit hook needs it.

The merge stopped on conflicts in these files:

{{files}}

Resolve them.
Read both sides with `git log --merge` and `git diff`.
Keep what both sides meant, not just one side.
The incoming commits are approved work or a member's own fixes. Never drop them.
A file one side deleted and the other changed needs the change carried to where the deleting side moved that code, or dropped if that side removed the feature.
Run the typecheck and the focused tests near the conflicted files.
Then commit the merge with `git commit --no-edit`.
Do nothing else. Do not touch files the merge did not change, and never add `.github/` files. The factory checks the commit and builds and tests the result after you.
