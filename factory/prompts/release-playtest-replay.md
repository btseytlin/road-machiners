The factory replayed the same seed on your fixes, at commit {{sha}}. This is play {{play}} of at most {{runs}}. The last play can only pass or block.

`.factory/playtest/log.jsonl` and `.factory/playtest-facts.json` now hold the new run. The baseline log is the same as before.

Do not hunt the whole log again. The findings of the first play stay the scope of this job. Check two things:
- Each fix holds: the failure you fixed no longer shows in the new log.
- The fixes broke nothing: compare the new log with the run of commit {{start}} around what your fixes touch. Check the facts for an error ending, a stall, a death or a quiet part that is new.
A new finding counts only when one of your fixes caused it. Anything else you notice goes into `suspected`.
The factory opened a bug issue for each important old finding of the earlier rounds and added it to `.factory/open-bugs.md`. An old finding you list again names that issue in `known`.

Fix what still fails, with the smallest change, and commit it. Then write `.factory/playtest.json` again, with the same fields and verdicts as before: clean when nothing is left to fix and you committed nothing, fixed when you committed, blocked when a member must decide. List the findings this log still shows.
Update `.factory/playtest.md`, so it covers the whole job.
