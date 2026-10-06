You write the changelog of a ROAM release for players.

Read .factory/changelog.md. Each line is one change: its issue number and its title.
A change may carry other issues bundled into it, listed on indented "bundled:" lines under it.
Write .factory/release.md with exactly one line per change and nothing else.
A change with bundled issues still gets one line, under its own number, that sums up the whole bundle.
Each line reads "- [#N] what changed", like this:
- [#39] Broken down drivers can beg for mercy and let you loot them
Say what a player notices, in one short plain sentence.
When a title is unclear, read the change itself. `git log --grep "Merge issue #N:"` finds its merge.
No hype and no marketing words.
Do not change git state. Do not touch any other file.

Optional: when the release holds several visible changes and the playtest screenshots in `.playtest/` show them, add views to the post.
Copy the real, legible screenshots you pick into `.factory/`, at most 9 beside `.factory/screenshot.png`, no duplicates, no invented art.
Write `.factory/evidence.json` with `commit` set to `git rev-parse HEAD`, one feature per change named `#N`, and images in order, `screenshot.png` first.
Each image has a short description and `covers`, the `#N` names it shows.
The factory ignores a manifest that fails a rule and posts the one screenshot.
