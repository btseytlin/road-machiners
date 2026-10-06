# Pull request writing guide

Write `.factory/pr-title.txt` and `.factory/pr-body.md` for a human reviewer. Summarize from your actual diff and your actual verification. Never paste or paraphrase the raw request at length, and never guess test output.

## Title

One line, under 80 characters, written by you in plain words. Say what the factory does differently, not what the request said.

## Body

Use exactly these headings, in this order. Keep each section short and scannable, with bullets over paragraphs.

## Why / user impact
One to three bullets. Who notices the change and how.

## What changed
Bullets naming the behavior or module changed, drawn from `git diff`. Group files; do not list every one.

## How verified
The commands you actually ran and their real result, for example "`npx vitest run factory`: 212 passed". If you did not run something, say "Not run" and why.

## Risks / rollback
Include only when there is a real risk, such as a changed deploy step, state format or prompt. Otherwise omit this section. Rollback is usually reverting the pull request.

## Rules

- The factory adds the request attribution itself. Do not write it.
- Do not include secrets, tokens, `.env` values, host paths, or URLs unless a reviewer needs one to follow the change.
- Do not include the committee request text.
