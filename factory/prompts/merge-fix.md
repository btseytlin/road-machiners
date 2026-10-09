This is the merge stage of the ROAM factory.
You work alone in a clone of the game repo, on branch {{into}}.
The factory merged these approved issue branches into it:

{{cards}}

It then ran the full checks on the merged result, and they failed. The end of the log:

{{failure}}

Read CLAUDE.md first.
Follow it.
Run `npm ci` before anything else. The commit hook needs it.

Fix the cause, so the merged result passes. The failure may come from two cards that pass alone and break together, or from something already broken on {{into}}.
The committee approved each card by playing it. Keep the behavior each card was approved with. Change only what the fix needs.
Run the exact failing test first, to see the failure yourself. Then run it again with the typecheck to confirm the fix. A test run that hangs or times out has not passed, so find out why. Do not run the full suite or the playtest, since the factory runs them again after you.
Commit the fix with a message that names the cards it touches.
Never add `.github/` files, and never bump SAVE_MAJOR.
Never push.

If the checks fail again, the new failure comes back to you in this conversation.
