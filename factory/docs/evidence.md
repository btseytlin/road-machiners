# Evidence

What agents hand to the committee, and what the factory checks before it posts.

## Visual evidence

A testing round that ends in a post writes `.factory/screenshot.png`, the primary, and `.factory/approval.json` with `description` and `howToTry`. It may write `.factory/evidence.json`, an ordered manifest of up to 10 images with the primary first. The manifest lists the visible `features` of the change and, per image, a short description and the features it `covers`. The factory checks these rules:

- Every feature has an image. A `location` has at least one real image. A `system` has an image marked `sheet`, a labeled contact sheet of real screenshots.
- Each file is a plain relative name inside `.factory/`, a real PNG, JPEG or WebP under 10 MB, with no link out of the folder and no duplicates.
- `commit` is the final head of the branch. A fix round that changed code must capture again, or the stage fails.
- With no manifest, the one screenshot posts. A manifest that breaks a rule fails the verify or patch job that wrote it.

Telegram gives a media group no buttons. So the approval post stays one photo with its caption and buttons, and the other images follow as a reply photo or album. Commands act on the primary only. When the album fails, the factory marks the primary superseded, drops its buttons and fails the stage with the card in Testing. The release candidate posts the same way, with an optional manifest that is logged and ignored when it breaks a rule.

## Visual review

Testing does not trust the implementation's claim that the look is right. A round that ends in a post finishes with the agent reading its final images and writing `.factory/visual-review.json`. It compares them with the issue, the task file, `game/docs/DESIGN.md` and the game docs. The factory checks the file for consistency:

- `commit` is the final head. `images` has one entry per shown image with its sha256, so a recapture needs a new reading. Each entry and each feature decision carries a `correct` or `wrong` verdict and notes of at least 20 characters.
- `visual: false` needs a reason and is refused when `evidence.json` lists features. A change nobody can see passes on its reason.
- A missing file, a stale hash, an unreadable image or a missing decision fails the stage. Nothing posts.

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
