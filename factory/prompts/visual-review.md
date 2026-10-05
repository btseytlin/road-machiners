Visual review of the final build
You review what the game shows, independent of what the implementation stage claimed.
Do this after your last commit, on the images you captured from the final build.

Skip it only for a change nobody can see, like a rule, a save step, a tool or a test.
Then write `.factory/visual-review.json` with `visual` false and a `reason` that says why nothing visible changed.
Never set `visual` false while `.factory/evidence.json` lists features.

For a change a player can see, work like this.
1. Read each shown image with the Read tool, one by one. Look at the pixels, not at your file names or captions.
2. Read the issue in `.factory/issue.md` when it exists, the plan in {{taskFile}}, `docs/DESIGN.md` and the game docs the change touches, like the art and mechanics docs.
3. For an external reference image, compare side by side as above, in `.factory/comparison.png`.
4. For an effect or an animation with no concept image, play it for real in the browser. Capture before and after frames, or a sequence at successive simulation points, like the flare as it launches and rises, or the oil as the truck drives on. A still cannot show direction or timing.
5. For every visible change and every important state, decide if it looks right. Check placement and direction (behind the truck, not ahead of it), shape (no perfect circle, box or other placeholder where the game wants an organic form), proportion and scale, readability against the ground, and states a player will meet, like start, active, end, and the other camera angles.
6. Write down every mismatch in plain words before you fix anything.

Classify each mismatch by what it takes to fix.
- `tune`: a value, a position, an orientation, a scale or a color of code that already exists is off. You fix it.
- `rebuild`: the shape, the state or the behavior needs new or replaced code, or the fix touches more than 3 files or 150 changed lines.
- `plan`: the plan in {{taskFile}} asks for the wrong thing, against the issue or the docs, so building it again would build the same thing.

Fix every `tune` mismatch yourself, commit it, capture the views again on the final commit and read them again.
Do this at most twice, and count the rounds in `repairs`.
Do not patch a `rebuild` or a `plan` mismatch. Do not weaken the issue to make the picture pass.
The factory sends a card with a `plan` mismatch back to Design, and one with a `rebuild` mismatch to Implementation. Both keep the branch, and your mismatch list goes to them. It gives a card two send-backs in all.
After two repair rounds, a `tune` mismatch that remains goes to Implementation too.

Write `.factory/visual-review.json` last, after the final capture and the final commit.
`{"commit": "<git rev-parse HEAD>", "visual": true, "repairs": 1, "images": [{"file": "screenshot.png", "sha256": "<sha256sum of the file>", "observations": "Oil lies behind the rear axle as an irregular spill, about two truck widths long.", "verdict": "correct"}], "decisions": [{"feature": "Oil patch", "verdict": "correct", "notes": "It trails the truck, as the issue asks, and reads against the sand."}], "mismatches": []}`
- `images` has one entry per shown image, the primary too, with the `sha256` of the file as it is now. The factory compares it.
- `observations` and `notes` say what you saw, at least 20 characters. No copy of the caption.
- `decisions` has one entry per feature of `.factory/evidence.json`, or one for the change when there is no manifest.
- `mismatches` lists only what still differs after your repairs, each with `description` and `scope`. A `wrong` verdict needs a mismatch. A clean review has an empty list and only `correct` verdicts.
Never write a reading of an image you did not open. Never invent a render.
When you cannot open or read an image, say so in `.factory/needs-committee.md` and stop. Do not approve a look you did not see.
