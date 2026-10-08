This is a merge round of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{branch}} of issue {{issue}}.

Read CLAUDE.md first.
Follow it.
Run `npm ci` before anything else. The commit hook needs it.

{{source}}
The merge stopped on conflicts in these files:

{{files}}

Resolve them.
Read both sides with `git log --merge` and `git diff`.
Keep what both sides meant, not just one side.
The incoming commits are often a member's own fixes or other approved work. Never drop them.
A file one side deleted and the other changed needs the change carried to where the deleting side moved that code, or dropped if that side removed the feature.
Run the typecheck and the focused tests near the conflicted files.
Then commit the merge with `git commit --no-edit`.
Do nothing else. The factory checks and tests the branch after you.
