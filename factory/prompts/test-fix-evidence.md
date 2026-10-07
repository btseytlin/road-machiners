Update `.factory/approval.json` if your fixes change what a player sees.
The evidence in `.factory/evidence.json` must come from the final commit of this round.
If you changed any code, capture every view again and rewrite the manifest after your last commit, with `commit` set to `git rev-parse HEAD`.
The factory rejects a manifest from an older commit, and this is the last round.
Keep the rules of the first round: every visible change shown, useful representative images of each changed location with no fixed count, a labeled real-screenshot sheet for a system-wide change, at most 10 images with `.factory/screenshot.png` first, no invented art, no duplicates.
Your very last step, after your last commit, is the factory's evidence check. Run `node /opt/factory-check/check.mjs test` from your folder.
It runs the checks the factory runs after you, on your clone as it is now, and prints each failure with the factory's message.
Fix every failure before you end. A fix needs a commit, new captures, a new manifest and a new visual review, and then you run the check again.
Run it again after any later commit. Do not end while it fails.
