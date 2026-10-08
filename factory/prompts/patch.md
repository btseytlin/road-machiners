This is the patch stage of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{branch}}.
Issue {{issue}} is built, and the committee played the build of commit {{played}}.
Its plan is in {{taskFile}}.

Read CLAUDE.md first.
Follow it.

The issue and its comments are in `.factory/issue.md`.
The last comment under "## Committee feedback" that says "routed as patch" is your task.
It is a small change that keeps the plan, like a constant, a copy fix, a look tweak or a missing view in the evidence.
Make that change and nothing else.

If the change needs a new plan, stop.
That means a new system, a changed data format, a new approach, or work across many files the plan did not name.
Write why in a few sentences to `.factory/needs-redesign.md` and commit nothing.
The card then goes back to design.

The factory merged the current base branch into your branch before you started.
If `.factory/merge-conflicts.md` exists, that merge stopped on conflicts in the files it lists.
Resolve them first.
Keep what both sides meant, not just one side.
Then commit the merge with `git commit --no-edit`.

Check only what you changed since the played build.
`git diff {{played}}..HEAD` shows it.
Run the focused tests near your change, and the typecheck.
Do not run the full test suite or the playtest. The factory runs them right after you.
This machine is shared and slow.

Commit on the current branch.
Never push.
Add one line under "Patches" in the Conclusion of {{taskFile}}: what the committee asked and what you changed.

Reference images from the issue, and any the committee sent with the reply in Telegram, are listed at the end of this prompt.
If the feedback is about a look, read the images and the feedback, take a screenshot of the finished game and compare.
The feedback text is your task. When it names the change in words, like a copy fix, act on the words, even when an image is NOT AVAILABLE.
An image that only shows the build again, like the factory's own screenshot, is context, not a new request.
Never say you looked at an image marked NOT AVAILABLE, and never describe what it shows.
If the change depends on a visual detail that only a missing image shows, and the text leaves it open, pick the most sensible reading of the text.
Write what you could not see and your reading into the Patches line of the task file and into the description of the manifest.
Do not stop.

Write `.factory/approval.json` again: `{"description": "...", "howToTry": "..."}`.
Lead the description with what this patch changed. The committee played the build before, so tell them where to look.
Then capture the evidence, as the testing stage does.
Write a Playwright script in `tmp/`. Launch Chromium without GPU flags.
Capture only from the final build of your final commit.
Save the primary view as `.factory/screenshot.png`, showing what the patch changed. Save the others next to it in `.factory/`.
Every image must be a real screenshot of the game, or a labeled contact sheet built from real screenshots. Never draw or invent art.
At most 10 images in total, the primary included.
Read each image with the Read tool before you list it.

Write `.factory/evidence.json`, the ordered list of images. The first is `screenshot.png`.
`{"commit": "<output of git rev-parse HEAD>", "features": [{"name": "Grid icons", "kind": "system"}], "images": [{"file": "screenshot.png", "description": "Top-down icons in the grid", "covers": ["Grid icons"], "sheet": true}]}`
List each visible change under `features`. The kind is `location`, `item`, `system` or `other`.
Each image has a description and `covers`, the exact feature names it shows. Keep the description under 200 characters, since the factory cuts a longer one. Every feature needs an image.
A `location` needs at least one real image that shows it, with no fixed count. A `system` needs an image with `"sheet": true`.
The factory rejects the manifest when `commit` is not the final head of the branch, so write it last, after your final commit.

If the change needs a major save format bump, stop.
Write what the committee must decide to `.factory/needs-committee.md`.
That file is only for a game design fork or a major save bump.

Your very last step, after your last commit, is the factory's evidence check. Run `node /opt/factory-check/check.mjs patch` from your folder.
It runs the checks the factory runs after you, on your clone as it is now, and prints each failure with the factory's message.
Fix every failure before you end. A fix needs a commit, new captures and a new manifest, and then you run the check again.
Run it again after any later commit. Do not end while it fails.
