This is the testing stage of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{branch}}.
Issue {{issue}} is built. Its plan is in {{taskFile}}.

Read CLAUDE.md first.
Follow it.
Run `npm ci` before anything else. The factory removes installed packages from clones between stages, and the commit hook needs them.

The factory merged the current base branch into your branch before you started.
If `.factory/merge-conflicts.md` exists, that merge stopped on conflicts in the files it lists.
Resolve them first.
Keep what both sides meant, not just one side.
Then commit the merge with `git commit --no-edit`.
The factory fails the stage if the merge is left unfinished.

This round gets the change ready to show to the committee. They play it and approve it, send feedback or deny it.
Check that the feature works for a player: play it end to end, as the task file describes it.
Playtest game behavior with the progression recorder, as `CLAUDE.md` says. Use the browser for what the screen shows.
Fix what breaks it or blocks it, and commit the fixes on the current branch.
Do not review the code, fix nitpicks or optimize here. That runs after the committee approves, if they do.

This machine is shared and slow. Keep checks focused.

Reference images from the issue are listed at the end of this prompt.
Read every available image with the Read tool.
When the issue or the task file wants the result to look like an image, a gameplay test is not enough.
Then run the visual comparison.
Take a screenshot of the finished game from the view of the image.
Put it next to the reference image in one file, `.factory/comparison.png`, and read that file with the Read tool.
List every mismatch you see in plain words, like "the cab is half as tall as in the image" or "the roof color is brown, the image has green".
Fix what does not match, rebuild, take the screenshot again and compare again.
Do this up to three rounds, and commit each fix.
Write the last comparison under "Visual comparison" in the Conclusion of {{taskFile}}.
It lists what matches, each mismatch that remains and why you left it.
The testing stage is not done until that section exists.
An image marked NOT AVAILABLE was not seen.
When the comparison depends on it, write that to `.factory/needs-committee.md` and stop.
The skill `blender-image-to-3d` has a compare sheet script, `compose_review.py`, for model renders.
Use it when the change is a Blender model.
Its overlap number is a diagnostic only.

Take screenshots of the finished game that together show EVERY visible change of this task, not one hero shot.
Write a Playwright script in `tmp/`.
Launch Chromium without GPU flags.
Capture only from the final build of the final commit. If you change code afterwards, capture again.
Save the primary view as `.factory/screenshot.png`. Save the others next to it in `.factory/`, like `.factory/view-gate.png`.
Every image must be a real screenshot of the game, or a labeled contact sheet built from real screenshots. Never draw or invent art.
No duplicates, no blurry or irrelevant views, no dump of many shots.
- For each changed location, show useful, representative in-game images: its layout and landmarks, and where useful the approach and the traversal through it. There is no fixed count. Use as many as the location needs to be judged, and one is enough when it shows what changed. When the image cap leaves too little room, one legible, truthful contact sheet of real screenshots may stand for several views.
- N new items need every item shown, one view each or one clearly legible combined image.
- A change across a whole system, like a grid on all vehicle types, needs one legible labeled contact sheet of real screenshots of representative affected cases, plus detail views if needed. Mark it with `"sheet": true`.
- One screenshot is enough only when it covers the whole change.
At most 10 images in total, the primary included. Choose or composite to fit.
Read each image with the Read tool before you list it.

Write `.factory/evidence.json`, the ordered list of images. The first is `screenshot.png`.
`{"commit": "<output of git rev-parse HEAD>", "features": [{"name": "Salvage yard", "kind": "location"}], "images": [{"file": "screenshot.png", "description": "Gate and landmarks", "covers": ["Salvage yard"], "sheet": false}]}`
List each visible change under `features`. The kind is `location`, `item`, `system` or `other`.
Each image has a description and `covers`, the exact feature names it shows. Keep the description under 200 characters, since the factory cuts a longer one. Every feature needs an image.
A `location` needs at least one real image that shows it. A `system` needs an image with `"sheet": true`.
Files are plain relative names inside `.factory/`, PNG, JPEG or WebP, under 10 MB, and a PNG's sides add up to under 10000 pixels.
The factory rejects the manifest when `commit` is not the final head of the branch, so write it last, after your final commit.

{{visualRules}}

Write `.factory/approval.json` with this shape.
`{"description": "...", "howToTry": "..."}`
The description is plain text about what changed, under 300 characters.
The howToTry text is the steps a committee member follows in the browser, under 400 characters.
They play the branch build from a link in the post, so start the steps from the loaded game, not from `npm run dev`.

The factory checks your branch after you finish.
It runs `npm test`, `npm run typecheck` and `{{playtest}}` against the dev server.
Every test must pass, not only the tests for this issue.
Do not run the full suite or the playtest yourself.
Run the tests near your changes with `npx vitest run <files>`, and `npm run typecheck`.
If the factory's checks fail, you get one round to fix them, with the failure log in `.factory/check-failure.md`.

A failure blocks the task even when your change did not cause it.
Fix every failure you find, also ones already broken on `dev`.
Put each such fix in its own commit.
Name it in the task file under Conclusion.

A failing saved-shape test means the saved world changed without a migration step.
Follow Save migrations in CLAUDE.md.
Add the step, its fixture and its test, then run `npm run save:shape`.
Only a major save bump goes to the committee.

If the work needs a major save format bump, stop.
Write what the committee must decide to `.factory/needs-committee.md`.

Never push.
