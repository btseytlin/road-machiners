This is the implementation stage of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{branch}}.
The plan for issue {{issue}} is in {{taskFile}}.

Read CLAUDE.md first.
Follow it.

Reference images from the issue are listed at the end of this prompt.
Read every available image with the Read tool before you build.
Build what the plan says and what the images show.
An image marked NOT AVAILABLE was not seen.
Never build as if you had seen it.
When the plan depends on it, write what is missing to `.factory/needs-committee.md` and stop.
When the task file asks for a visual acceptance check, render or screenshot your work from the image's view, compare it with the image, fix the biggest mismatch and repeat.
Stop after three rounds, or when nothing differs that a player would see.

Visual self-review
The issue and its comments are in `.factory/issue.md`.
Every task with a change a player can see needs this, with or without a reference image. That covers effects, UI, locations, models and animation.
1. Build and run the affected gameplay, as a player meets it. Capture real in-game screenshots with a Playwright script in `tmp/`, without GPU flags. Take representative states and camera angles, like the start, the active state, the end and the view from the side.
2. Read every screenshot with the Read tool. Look at the pixels.
3. Compare them with the issue, the plan in {{taskFile}}, `docs/DESIGN.md` and the game docs the change touches, like the art and mechanics docs.
4. Write down every obvious mismatch in plain words. Look for placeholder shapes that should not ship, like a perfect circle or a plain box, wrong direction or placement, like ahead of the truck when the issue says behind it, wrong proportion or scale, poor readability against the ground, and missing states.
5. Fix each mismatch, capture again, read the new images and compare again. Do this until nothing obvious differs. Do not claim you are done before that.
A look that a still cannot show needs a short playback in a real browser, or frames at successive simulation points. Examples are a flare that launches and rises, and oil that drops behind a moving truck. Read those frames too.
Keep the screenshots in `tmp/`. Do not commit them, unless CLAUDE.md says the repo keeps such files.
Never use a drawn or invented render, or a text claim, in place of a real capture.
Write the result under "Visual self-review" in the Conclusion of {{taskFile}}. It lists the views you read, each mismatch you found and fixed, and what remains.
A task nobody can see, like a rule, a save step or a tool, needs no screenshots. Write under "Visual self-review" in the Conclusion why nothing visible changed, and skip the rest.

When `.factory/issue.md` has a comment under "## Visual review findings", the build exists and the testing agent found these mismatches in its gameplay images.
Fix those first, then run the self-review above on every view the findings name.

Modeling an asset from a reference image
Use the `blender-image-to-3d` skill when the work builds or reshapes a game model that a reference image shows.
Read its SKILL.md, then only the reference files for your asset category.
Blender 5.2.2 is on the path. Pass `--engine cycles` to its review_render.py.
ROAM models are low-poly scripts in `tools/blender/` that write a committed `.glb`.
CLAUDE.md says how to write and build them, and it wins over the skill's build template.
Take from the skill what a reference-driven model needs.
That is the Phase 0 brief with its measured proportions and its list of what the image does not show, the calibrated master file, and the render and compare gates.
Skip its baking, UV, rig, LOD and export phases, unless the issue asks for them.
Do not run all ten phases.
Do not use the skill for work that has no reference image.
A silhouette overlap number from compose_review is a diagnostic.
Never make it a pass or fail gate for a perspective concept, since the skill itself says such an image shows silhouette and detail, not proportions.
Judge the compare sheet by looking at it, and write each mismatch as a measurement or a plain description.

Install the hooks first.
Run `npm ci && npm run hooks:install`.
The quality hook checks every commit.
Do not bypass it.
Do not add suppressions.
Do not raise its limits.

Run up:uexecute on {{taskFile}}.
Implement every phase inline in this session.
Subagents are off.
Then stop.
Do not run up:uverify.
The next stage does that.

This machine is slow. Keep checks focused.
While you work, run only the tests near your change with `npx vitest run <files>`.
Prove the feature works with a targeted test, or a short Playwright check of that one behavior.
Do not run the full test suite or the playtest. The factory's checks run both after the testing stage.
Before you finish, run `npm run typecheck` once.
Every test you ran must pass, not only the tests for this issue.

A failure blocks the task even when your change did not cause it.
Fix every failure you find, also ones already broken on `dev`.
Put each such fix in its own commit.
Name it in the task file under Conclusion.

A failing saved-shape test means the saved world changed without a migration step.
Follow Save migrations in CLAUDE.md.
Add the step, its fixture and its test, then run `npm run save:shape`.
Only a major save bump goes to the committee.

Commit in phases on the current branch.
Never push.

If the work needs a major save format bump, stop.
Write what the committee must decide to `.factory/needs-committee.md`.
Do not commit a change to `SAVE_MAJOR`.
