# The factory starts a job only when its memory fits

## Context
- The server has 8 cores and 15.5 GB of RAM. The tick starts jobs up to fixed counts per queue, and nothing checks memory.
- On 2026-10-06 at 21:05 the server ran 4 checks, 2 verify jobs and several implement jobs. 4.7 GB sat in swap and 1 GB was available.
- The kernel ran out of memory 21 times in 3 days. Each time it killed the biggest process on the host, mostly the Chrome of some job. That job then failed as if its code broke.
- The tick already holds all starts when free disk is low. Memory has only a Hermes incident and no hold.
- Agent jobs use little memory while they wait on the model and a lot while they run tests. So the memory that is free right now says little about what running jobs will need soon.
- The game's test runner starts one worker per CPU it sees, up to 6, and each worker holds 0.4 to 0.9 GB.
- Implement agents run the full game test suite before they finish. Checks run the same suite right after them.

## Desired design
The tick starts a job only when the memory that job may need fits. No job is stopped or limited once it runs.

- Each CPU pool gets an expected peak memory per job, in GB, in `settings.env`. The values come from measured peaks.
- `settings.env` gets a host reserve in GB for everything outside job containers. That covers Hermes, Caddy, docker, the desktop session and the job processes.
- The tick adds up the expected peaks of the running jobs. It starts a new job only when that sum, plus the new job's peak, plus the host reserve, fits in the total RAM.
- The tick also checks the memory available right now. It starts a job only when the available memory covers the new job's peak. This catches load from outside the factory.
- A job held for memory waits in its queue with a "memory" reason, the way "daily-cap" shows today. The dashboard and Hermes see it.
- Queue counts stay as an upper bound per queue, so one queue cannot take every slot.
- Each container prints its measured peak memory when it ends, and the job records it in the ledger. A job that goes over its pool's expected peak gets a Hermes note, so the setting can be raised. The job itself still succeeds or fails on its own work.
- Agent test runs use fewer test runner workers, through a `TEST_WORKERS` env the factory passes, like `TEST_TIMEOUTS`. Implement agents stop running the full suite. Both lower agent peaks, so more agents fit.

Hardware note: the server is a Legion Y540. Its two RAM slots likely take 32 GB in total, which would let about twice as many jobs start.

## Invariants and principles
- A running job is never killed or limited by this change.
- The tick never starts a job whose peak does not fit. A test covers fit and no-fit.
- Each settings comment states the measured numbers it rests on.
- Game and factory still never import each other. `TEST_WORKERS` is an env contract.

## Implementation plan
### Phase 1: measure and lower the load now
- `settings.env`: set `FACTORY_TEST_WORKERS=2` and `FACTORY_IMPLEMENT_WORKERS=3` until the memory gate exists. Update the comments.
- `src/container.ts` and the `factory-agent` entrypoint in `docker/`: print the cgroup's `memory.peak` at exit on one marked line. Record it per run in the ledger.
- `src/container.ts`: pass `TEST_WORKERS` per pool. `game/vitest.config.ts` uses it when set.
- `prompts/implement.md`: run the typecheck and focused tests only. The checks run the full suite right after.

### Phase 2: the memory gate
- Read a day of recorded peaks per pool. Set each pool's expected peak to its highest peak, rounded up to 0.5 GB.
- `settings.env`, `src/config.ts`, `src/types.ts`: add `FACTORY_MEM_LIGHT_GB`, `FACTORY_MEM_IMPLEMENT_GB`, `FACTORY_MEM_TEST_GB` and `FACTORY_MEM_HOST_GB`.
- `src/tick.ts`: add the "memory" reason next to `findCapacityReasons`, using the running jobs, the picks of this tick, `os.totalmem()` and the available memory from `src/health.ts`.
- Raise the queue counts back, since the gate now holds what does not fit.
- Update `docs/process.md` and `docs/operations.md`.

## Verification
- Factory tests for the gate and the container args. Run only the touched test files.
- `npm run typecheck` in `factory/` and `game/`, and `npm run quality` at the root.
- Manual try, positive: on the server, a finished checks run has its peak in the ledger.
- Manual try, negative: with the running jobs' peaks near the total, the tick holds a ready job with the "memory" reason and starts it once a job ends.
- After phase 2, a day shows no OOM kills in `journalctl -k` and swap near zero.

## Result
- Phase 1 is done on two branches. `memory-gate` from `main` holds the factory part. `memory-gate-game` from `dev` holds the game's `TEST_WORKERS` support.
- Checks run 2 at once and implement 3 at once. Implement and verify containers start 2 test workers. Implement agents no longer run the full suite.
- Every job container prints its peak memory on exit, and the job writes the highest as `peakGb` on its ledger line.
- Checks run: the touched factory tests passed, 143 tests. The quality gate passed on both branches. A game test ran with `TEST_WORKERS=2`, and `TEST_WORKERS=abc` failed loud.
- Manual try on the server's agent image: a container that allocated 300 MB printed a peak of 321216512 bytes. A script that exits 3 still exits 3 with the trap.
- Phase 2 waits for a day of `peakGb` data on the server after both branches merge.
