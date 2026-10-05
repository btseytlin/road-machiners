# CPU pools for factory jobs, and a safety net for check timeouts

## Context
- The factory checks time out because every container can use all 4 CPUs. On 2026-10-03 checks ran beside 4 or 5 agents, with load 15 to 30. Tests that take 2.5 minutes alone hit their time limits.
- Today a check timeout goes to the agent for one fix round. The agent then raises test time limits, as #81 did 3 times. A second failure labels the card `factory-stuck`, and nothing handles it.
- The user wants CPU split by ratio, so a bigger server keeps working. Triage, design and branch jobs share one pool, implement gets one, and testing gets the rest.

## Design
- Three CPU pools, set as ratios in `factory/settings.env`:
  - `FACTORY_CPU_LIGHT=0.25` for triage, design and the branch queue.
  - `FACTORY_CPU_IMPLEMENT=0.25` for implement and ad hoc jobs.
  - `FACTORY_CPU_TEST=0.5` for testing.
- Each pool gets a fixed set of whole CPUs: round(ratio × cores), at least 1. On 4 cores this gives light CPU 0, implement CPU 1 and test CPUs 2-3. On 8 cores it gives 0-1, 2-3 and 4-7.
- Every job container is pinned to its pool with `docker run --cpuset-cpus`. Jobs of one pool share its CPUs, so triage, design and a dev build share one CPU.
- Pinning by cpuset, not by a CPU quota, is deliberate. Node's `availableParallelism()` follows the pinning, so the game's vitest config, `game/vitest.config.ts`, starts 2 workers on 2 CPUs by itself. A quota would leave vitest at 4 workers on 2 CPUs, and the timeouts would come back. No game change is needed.
- A pool cannot borrow idle CPUs from another pool. That is the price of the guarantee.
- Config fails loud when the ratios add up to more than 1, a pool rounds to 0 CPUs, or the pools need more CPUs than the server has.
- Safety net for timeouts in `src/stages/testing.ts`:
  - A check failure where every error in the log is a timeout counts as load. The error lines are `Test timed out in`, `Hook timed out in` and `Timeout calling "onTaskUpdate"`.
  - The factory reruns such checks itself, up to 3 runs in total, with no agent round.
  - After 3 timed-out runs, the stage fails with "The factory checks timed out 3 times, under load". Hermes gets a rule for it.
  - Any other failure keeps today's path, with one agent fix round and a second check run.
- The worker limits per queue stay as they are.

## Files
- `factory/settings.env`: the 3 ratio keys, each with its reason in a comment.
- `factory/src/types.ts` and `factory/src/config.ts`: add `cpuLight`, `cpuImplement` and `cpuTest` to `FactoryConfig`, parse them as numbers, and check that they sum to 1 or less.
- New `factory/src/cpus.ts`:
  - `POOL_OF: Record<Queue, Pool>` maps triage, design and branch to light, implement to implement, and test to test.
  - `cpuSets(cfg, cores)` returns `{ light, implement, test }` as cpuset strings like `"2-3"`.
- `factory/src/jobs.ts`: `spawnJob` gets a `cpus` argument and passes it to the job as `FACTORY_JOB_CPUS`, beside `FACTORY_JOB_ID`.
- `factory/src/tick.ts`: `startJob` computes the job's set with `cpuSets(ctx.cfg, availableParallelism())[POOL_OF[QUEUE_OF[stage]]]`. `TickDeps.spawn` gets the same argument.
- `factory/src/context.ts` and `factory/src/container.ts`: `dockerContainer` takes the cpuset. `baseArgs` adds `--cpuset-cpus <set>` when it is set. A run by hand has none, so it stays unpinned.
- `factory/src/stages/testing.ts`:
  - Add `timeoutOnly(log)` and a `checkUntilReal` loop around `runChecks`.
  - `runStage` sends only failures that are not timeouts to the agent fix round.
- `factory/prompts/test-fix.md`: do not raise a test's time limit unless this change made that test slower.
- `factory/hermes/SOUL.md`: add a rule for "checks timed out 3 times". Read the load with `uptime` and `docker stats --no-stream`. Retry by removing the label once the load falls. Post to the committee when it repeats.
- `factory/README.md`: document the pools and the timeout rerun.
- Task file `factory/docs/tasks/cpu-pools.md` with this plan and its result.

## Verification
- Run `npx vitest run src/cpus.test.ts src/config.test.ts src/container.test.ts src/tick.test.ts src/stages/testing.test.ts src/jobs.test.ts`. New cases:
  - Sets for 2, 4 and 8 cores.
  - Errors for a sum over 1 and for a pool that rounds to 0.
  - `--cpuset-cpus` appears in agent and shell args only with a set.
  - spawn gets the pool of each stage.
  - Timeout-only failures rerun without an agent and pass on the second run.
  - 3 timed-out runs fail with the load message and no agent round.
  - A real failure still gets one fix round.
- `npx tsc --noEmit`, `npm run quality` and `uv run --with pytest --with pyyaml pytest hermes` pass.
- Manual try on the server after deploy, positive: `docker inspect -f '{{.HostConfig.CpusetCpus}}'` on running job containers shows `0`, `1` or `2-3` by stage. `nproc` inside a test container prints 2.
- Manual try, negative: a factory `.env` or settings with ratios summing to 1.2 stops the tick with a clear config error. Check this locally with `loadConfig`, not on the server.

## Result
- Done. The tick pins each job's containers to its pool's CPUs, from the shares in `settings.env`. Checks that only time out rerun with no agent round, up to 3 runs, then fail with a load reason that Hermes has a rule for.
- `npx vitest run src/cpus.test.ts src/config.test.ts src/container.test.ts src/tick.test.ts src/jobs.test.ts src/stages/testing.test.ts`: 135 passed. `npx tsc --noEmit`: clean. `uv run --with pytest --with pyyaml pytest hermes`: 111 passed. `npm run quality`: passed.
- Manual try on the server, positive: `docker run --cpuset-cpus 2-3 roam-factory:dev` printed 2 for `nproc` and 2 for node's `availableParallelism()`, so the game's test runner starts 2 workers.
- Manual try, negative: shares that add up to 1.2 fail `loadConfig` with a clear message, and pools that need more CPUs than the server has fail `cpuSets`. Both are covered by tests.
- Not verified on the server yet: pinned job containers after deploy.
