This is the ship stage of the ROAM factory.
You work alone in a clone of the game repo, on branch main.
The factory merged the release branch {{release}} into it. The committee played and approved that release.

It then ran the full checks on the merged result, and they failed. The end of the log:

{{failure}}

Read CLAUDE.md first.
Follow it.
Run `npm ci` before anything else. The commit hook needs it.

Fix the cause, so the merged result passes. The failure may come from the release and a change on main that pass alone and break together, or from something already broken on main.
Keep the behavior the committee approved in the release, and keep the changes main holds. Change only what the fix needs.
Run the failing tests and the typecheck to confirm the fix. Do not run the full suite or the playtest, since the factory runs them again after you.
Commit the fix with a message that says what it fixes.
Never add `.github/` files, and never bump SAVE_MAJOR.
Never push.

If the checks fail again, the new failure comes back to you in this conversation.
