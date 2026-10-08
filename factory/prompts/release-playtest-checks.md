The factory checks failed on {{sha}}, the commit your last play passed. They run the game's tests, the typecheck, a browser playtest and the build in this clone. `.factory/check-failure.md` holds the end of their log.

Fix the cause with the smallest change and commit it. A test that fails because of your fix needs the fix changed, or the test changed when the fix is right. Never raise a time limit, skip a test or weaken a check.
Do not write `.factory/playtest.json` now. The factory replays the seed on your commit, and you review that play next.
