# Evidence

What agents hand to the committee, and what the factory checks before it posts.

## Visual evidence

A testing session that ends in a post writes `.factory/approval.json` with `description` and `howToTry`. The post checkpoint counts a missing one as a failure and hands it back to the session. The session also writes `.factory/screenshot.png`, the primary, and may list more images in order in `.factory/evidence.json`: `{"images": [{"file": "view-gate.png", "description": "Gate and approach"}]}`.

The testing session judges the look itself. It reads its own screenshots, compares them with the issue, the task file, the reference images, `game/docs/DESIGN.md` and, for the UI, `game/docs/ui.md`, and fixes what looks wrong. No file records that reading, and nothing checks it.

Evidence never blocks a card. The post shows the images as the agent listed them. With no screenshot, the approval post is a text message with the same Approve and Deny buttons, post mapping and reply routing, and a status line edits its text. It opens with "No screenshot", and the issue comment says what was missing. An image the post cannot show is left out, alone, and the issue comment names it:

- a name that is not a plain relative path inside `.factory/`, or a link out of the folder;
- a file that is not a real PNG, JPEG or WebP under 10 MB, or one Telegram refuses for its size;
- a duplicate of an image already shown;
- any image past the tenth, Telegram's album limit.

A manifest that is not JSON is ignored, and the one screenshot posts.

The agent can see what the post would lose before it ends. Every agent container mounts `node /opt/factory-check/check.mjs`, the factory's own code, read only, so the agent cannot change it and the two cannot drift. `check.mjs test` reports a missing approval and every image the post would leave out, and names the checks it cannot run.

Telegram gives a media group no buttons. So the approval post stays one photo with its caption and buttons, and the other images follow as a reply photo or album. Commands act on the primary only. When the album fails, the factory marks the primary superseded, drops its buttons and fails the stage with the card in Testing. The release candidate posts the same way, and it needs a usable screenshot.

## Diff guard

The diff guard refuses a change that touches `.github/`, `.factory/`, `.factory-tasks/` or `.factory-media/`, or that adds or removes a `SAVE_MAJOR` assignment in `game/src/three/save-migrations.ts`. A major save bump is a question for the committee, so it stops the stage for Hermes at once.

Every work clone runs `check.mjs guard` as its pre-commit hook on the staged change, so the agent learns of a refusal at its commit. On the host the command is not mounted, and the hook passes. The factory runs the same guard on every push and on everything the merge queue takes, and stays the gate.

## Ad hoc files

The factory never publishes an ad hoc file. It never copies one into the web root, puts one or a link to one in a GitHub comment or a log, or turns one into a URL. Only `/dev/`, `/rc/` and the approval builds are public.

- The agent writes each file into `.factory/files/` of its clone. `report.md` stays a short text answer.
- Only plain files directly in that folder pass. The extension must be html, htm, pdf, csv, tsv, json, txt, md, log, png, jpg, jpeg, gif, webp, svg or zip. A file must not be empty or over 50 MB, the Bot API limit. A task sends at most 10 files and 100 MB.
- The checked files go to `$FACTORY_HOME/adhoc-artifacts/issue-N/`, which only the factory user can read. The report replies to the member's message, and each file follows with `sendDocument`.
- A bad file or a failed upload fails the stage and tells the chat why. The copy stays until a delivery works.
