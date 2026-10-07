# Evidence

What agents hand to the committee, and what the factory checks before it posts.

## Visual evidence

A testing round that ends in a post must write `.factory/approval.json` with `description` and `howToTry`. The prompts ask it to also write `.factory/screenshot.png`, the primary. It may write `.factory/evidence.json`, an ordered manifest of up to 10 images with the primary first. The manifest lists the visible `features` of the change and, per image, a short description and the features it `covers`.

Evidence never blocks a card. With no screenshot, the approval post is a text message with the same Approve and Deny buttons, post mapping and reply routing, and a status line edits its text. It opens with "No screenshot", and the issue comment says what was missing. A manifest that breaks a rule is dropped, the one screenshot posts, and the issue comment says why. The manifest rules:

- Every feature has an image. A `location` has at least one real image. A `system` has an image marked `sheet`, a labeled contact sheet of real screenshots.
- Each file is a plain relative name inside `.factory/`, a real PNG, JPEG or WebP under 10 MB, with no link out of the folder and no duplicates.
- `commit` is the final head of the branch. A fix round that changed code must capture again.
- With no manifest, the one screenshot posts.

The agent can run these checks before it ends. A testing, fix or patch run that writes evidence gets `node /opt/factory-check/check.mjs <round>`, where the round is `test` or `patch`. Its prompt tells the agent to run it from its folder as the very last step, after its last commit, and to fix every failure it prints. It exits nonzero on any failure. A missing approval stops the stage. A missing screenshot, a broken manifest or a broken visual review does not, but the post loses what it cannot show, so the check counts them as failures too.

The command is the factory's own code. The factory bundles `src/agent-check-bin.ts` for each such run and mounts the folder read only, so the agent cannot change it and the two cannot drift. It runs the checks that read only the clone's files and git state: the approval, the manifest and the visual review, at the clone's head. It keeps going after a failure, so one run lists every failure with the factory's message. It also names the checks it cannot run: the diff guard, the base merge and the fresh-clone tests, typecheck, playtest and build. The factory still runs every check after the stage and stays the gate.

Telegram gives a media group no buttons. So the approval post stays one photo with its caption and buttons, and the other images follow as a reply photo or album. Commands act on the primary only. When the album fails, the factory marks the primary superseded, drops its buttons and fails the stage with the card in Testing. The release candidate posts the same way, with an optional manifest that is logged and ignored when it breaks a rule.

## Visual review

Testing does not trust the implementation's claim that the look is right. A round that captured a screenshot finishes with the agent reading its final images and writing `.factory/visual-review.json`. It compares them with the issue, the task file, `game/docs/DESIGN.md` and the game docs. The factory checks the file for consistency:

- `commit` is the final head. `images` has one entry per shown image with its sha256, so a recapture needs a new reading. Each entry and each feature decision carries a `correct` or `wrong` verdict and notes of at least 20 characters.
- `visual: false` needs a reason and is refused when `evidence.json` lists features. A change nobody can see passes on its reason.
- A missing file, a stale hash, an unreadable image or a missing decision is logged and ignored. The card goes on to the checks.

Each remaining mismatch has a scope.

- `tune` is a value, position, orientation, scale or color of existing code. The agent fixes it, in at most two repair rounds with a recapture each.
- `rebuild` is a new or replaced shape, state or behavior, or more than 3 files or 150 lines. The card goes to Implementation.
- `plan` means the plan contradicts the issue or the docs. The card goes to Design, and this wins over `rebuild`.

A send-back comments the mismatches under "## Visual review findings", clears the test phase and moves the card with its branch kept. A card gets two send-backs, and a third fails the stage. A passed review clears the count.

## Ad hoc files

The factory never publishes an ad hoc file. It never copies one into the web root, puts one or a link to one in a GitHub comment or a log, or turns one into a URL. Only `/dev/`, `/rc/` and the approval builds are public.

- The agent writes each file into `.factory/files/` of its clone. `report.md` stays a short text answer.
- Only plain files directly in that folder pass. The extension must be html, htm, pdf, csv, tsv, json, txt, md, log, png, jpg, jpeg, gif, webp, svg or zip. A file must not be empty or over 50 MB, the Bot API limit. A task sends at most 10 files and 100 MB.
- The checked files go to `$FACTORY_HOME/adhoc-artifacts/issue-N/`, which only the factory user can read. The report replies to the member's message, and each file follows with `sendDocument`.
- A bad file or a failed upload fails the stage and tells the chat why. The copy stays until a delivery works.
