The committee waived the screenshot for this issue, so this round has no visual evidence.
This overrides every instruction above about screenshots, `.factory/screenshot.png`, `.factory/evidence.json` and `.factory/visual-review.json`.
Do not capture screenshots and do not write those files. Never draw or invent an image.
Still play the feature end to end in the browser, fix what blocks it and commit the fixes.
Write `.factory/approval.json` as above.
Say in its description only what you checked by playing or by tests. Do not claim anything about how it looks.
Your very last step, after your last commit, is the factory's check of your approval. Run `node /opt/factory-check/check.mjs waived` from your folder, and use it instead of any other check command above.
Fix every failure it prints before you end.
