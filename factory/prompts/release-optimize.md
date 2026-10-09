Make the game faster against its speed budget.

Read CLAUDE.md first. The speed budget is `scripts/perf-budgets.json`, and `npm run perf` checks it.

1. Start the dev server and run `npm run perf -- --url <dev server>`. Other jobs share the GPU, so run it again to confirm any miss.
2. If any metric is over its budget, profile the metrics that miss. Find the core cause behind the main slowdowns.
3. If every metric is within budget, profile the slowest metric anyway and look for a core cause.
4. A core cause is a pattern that makes many spots slow, like derived data rebuilt on every call or work done each frame that only changes each turn. Fix the cause, not one spot.
5. Design the fix with the perf numbers before it, the cause and how you found it, and the change. Say in the plan how to measure it after. The build reruns `npm run perf` and reports the numbers before and after.

Keep the behavior of the game the same. Do not raise the budgets.

Answer "won't do" only when every metric is within budget and profiling finds no core cause. Give the perf numbers as the reason.
