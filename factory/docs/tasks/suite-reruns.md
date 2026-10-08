# The factory stops rerunning game tests that already passed

**Status:** validating
**Branch:** test-cache-factory (factory, off main); test-cache-game (game tool, off dev)
**Worktree:** .worktrees/test-cache-factory, .worktrees/test-cache-game
**Goal:** Checks skip every test file whose inputs already passed, so timeout reruns, fix rounds and conflict merges run only the tests their change can affect. Confirming the saving needs a few days of real factory runs, measured the same way as `tmp/testrep/`, against the baseline below.
**Mode:** interactive

## Context
- From 2026-10-02 to 2026-10-08, checks ran the full game suite 361 times on 92 cards, for about 85 hours. 87% of runs passed every file. One card ran it 13 times.
- The suite step takes 15 minutes at the median and 25 at p90, depending on host load. The playtest takes about 1 minute, and the build takes under 1 minute. The typecheck runs beside the suite.
- 54 suite runs followed a conflict at approve. The merge agent resolves it, checks rerun the whole suite, and dev moves again before approve. Cards #112 and #174 cycled 4 to 5 times overnight on 2026-10-07.
- 79 suite runs were `checks-after-fix`, and each one reran all 226 files after a fix that touched a few.
- 12 runs only timed out, and `checkPatiently()` in `src/stages/checks.ts` reran the same commit in full.
- A clean merge into dev runs no tests at all, so dev is never a known-green commit.
- About 27 game test files read files from disk at run time, like maps, models, CSS and wiki pages. Their import graph does not show these files.
- Agents run targeted test files. Only 34 of their 4,048 test calls repeated a command in the same session.

## Design
Each game test file gets a fingerprint. It hashes the contents of every file the test imported or read, plus the listings of every folder it read, plus the global inputs. A test file whose fingerprint already passed is skipped. The rule covers all three causes with no special cases. A timeout rerun runs only the timed-out files. A fix round runs only the files the fix reached. A conflict merge runs only tests whose inputs differ from a combination that some earlier checks run passed.

The global inputs are `package-lock.json`, `vitest.config.ts`, the setup and runner files under `src/test/`, the Node version and the env values the tests read, like `TEST_TIMEOUTS`. A card that edits any of them gets its own fingerprints, so it cannot vouch for other cards.

The tool lives in `game/` as an npm script that takes a cache folder. It runs vitest on the selected files and records each file's inputs as it runs. Imports come from vitest's module graph, and disk reads come from a hook on `node:fs` in a setup file. It writes a pass entry only for a file that passed in full. With no cache folder, or an empty one, it runs every file. `npm test` stays as it is.

The factory keeps the cache in `$FACTORY_HOME/test-cache/` and mounts it only into the checks container. The checks script calls the tool instead of `npm test`. Typecheck, playtest and build run every time, as now. The tick prunes entries older than a `settings.env` limit, beside the other sweeps.

The release candidate runs the full suite with no cache. A failure there fails the candidate like its playtest does. This is the net for any input the fingerprint misses.

Rejected: diffing against the last green commit with `vitest --changed`. It misses disk reads, so every asset or wiki change needs the full suite. Conflict merges would diff against everything dev gained, so they would still run most of the suite.

TDD: yes. Fingerprint, selection and cache writes are deterministic logic that a regression would silently break.

### Invariants
- IV1 — A test file is skipped only when a cache entry matches the current contents of every file it imported or read, the listing of every folder it read, and the global inputs.
- IV2 — The tool writes a pass entry only for a test file whose every test passed in that run.
- IV3 — Only the checks container mounts the cache folder. Agent containers never see it.
- IV4 — A corrupt cache entry or a tool error fails the checks with a message naming the entry or the error. An empty cache is normal and runs every file.
- IV5 — Each checks run logs how many test files it ran and skipped.
- IV6 — The release candidate runs the full suite with no cache.

### Principles
- PC1 — The tool owns everything about the game's tests. The factory only mounts a folder and calls an npm script, since game and factory never import each other.

### Assumptions
- AS1 — A test file's result depends only on its inputs as defined in IV1, apart from load, timing and randomness.
- AS2 — Game tests read disk only through `node:fs`, not through child processes or `fetch`.
- AS3 — Recording inputs adds under 5% to a suite run.
- AS4 — Most reruns change few inputs, so the tool skips most files on timeout reruns, fix rounds and conflict merges.

### Unknowns
- UK1 — Resolved in planning. After `startVitest()`, walking `project.vite.moduleGraph` from each test file gives its imports, `.glb` assets included.
- UK2 — Resolved in planning. A setup file that wraps `node:fs` and calls `syncBuiltinESMExports()` sees named imports and import-time reads under the default forks pool. It caught wiki pages, CSS, models and snapshot files.
- UK3 — Resolved in planning. A failing `ctx.container.shell()` in `candidate()` fails the job, which labels the card stuck. The full suite goes in `playtestScript` after `npm ci`.
- UK4 — The cache size after a week. The prune age reuses 14 days, the same as job logs.

## Plan

Approach: the game owns the tool and its cache format. The factory mounts a folder, calls one npm script, prunes old files by age and adds the uncached suite to the candidate. The two phases sit on different branches and share only IF1 and IF2, so they run in parallel.

### PH1 — Game: cached test runner (branch `test-cache-game`)
- 1.1 `game/src/test/cache/fingerprint.ts` (create)
  - `type Input = { path: string; kind: 'file' | 'dir' | 'missing' }`
  - `globalKey(root: string, define: Record<string, unknown>, env: NodeJS.ProcessEnv) -> string` — hashes `package-lock.json`, `vitest.config.ts`, every non-test file under `src/test/`, the resolved `define` values, the Node version and `TEST_TIMEOUTS`.
  - `fingerprint(root: string, globalKey: string, inputs: Input[]) -> string` — hashes each input's current state. A file hashes its bytes, a folder its sorted names, and a missing path a fixed mark. Respects IV1.
- 1.2 `game/src/test/cache/store.ts` (create)
  - `passedFingerprints(cache: string, test: string) -> Input[][]` — reads the input lists recorded for a test file. A corrupt entry throws with its path. Respects IV4.
  - `hasPass(cache: string, test: string, fingerprint: string) -> boolean` — also touches the entry's mtime, so pruning keeps entries in use.
  - `recordPass(cache: string, test: string, fingerprint: string, inputs: Input[]) -> void` — writes `entries/<sha1(test)>/<fingerprint>.json` through a temp file and a rename, since checks jobs share the folder.
- 1.3 `game/src/test/cache/reads-setup.ts` (create)
  - A setup file that wraps the `node:fs` read calls once per worker and calls `syncBuiltinESMExports()`. It records each path per test file and writes the list to `$TEST_CACHE_READS/<sha1(test)>.json` in `afterAll`. The wrapped calls are `readFileSync`, `readdirSync`, `existsSync`, `statSync`, `lstatSync`, `openSync`, `readFile`, `createReadStream`, `promises.readFile` and `promises.readdir`.
- 1.4 `game/src/test/cache/select.ts` (create)
  - `selectTests(root, cache, key, tests: string[]) -> { run: string[]; skipped: string[] }` — skips a test file only if one of its recorded input lists fingerprints to an existing pass. Respects IV1.
  - `inputsOf(root, test, graphFiles: string[], reads: string[]) -> Input[] | null` — joins imports and reads into repo-relative inputs. It drops `node_modules`, which the lockfile covers. It returns null when the test read a path outside the repo, and the test then always runs.
- 1.5 `game/scripts/test-cache.mjs` (create), run by `vite-node`
  - Parses `--cache <dir>`. Lists the test files, selects, and runs the selected ones with `startVitest()` and the extra setup file. It records passes for files whose every test passed, prints `[test-cache] ran N, skipped M, uncacheable K`, and exits non-zero on any failure. Respects IV2, IV5.
- 1.6 `game/package.json:7` (modify) — adds `"test:cached": "vite-node scripts/test-cache.mjs --"`.
- 1.7 `game/CLAUDE.md:31` (modify) — one line on `npm run test:cached -- --cache <dir>` and that the factory checks use it.
- Tests, written first: `game/src/test/cache/fingerprint.test.ts`, `store.test.ts` and `select.test.ts` on temp folders.
- Commit: `Cached game test runner skips test files whose inputs already passed`

### PH2 — Factory: use the cache, prune it, full suite on the candidate (branch `test-cache-factory`)
- 2.1 `factory/src/types.ts:270` and `factory/src/container.ts:216-222` (modify)
  - `shell(clone, script, log, env = {}, mounts: Record<string, string> = {})` — mounts each host folder read-write. Only checks passes one. Respects IV3.
- 2.2 `factory/src/stages/checks.ts:17-47, 141-152` (modify)
  - `checkScript` runs `npm run test:cached -- --cache /test-cache` instead of `npm test`, with the RK1 path for a branch that lacks the script.
  - `runScript()` passes `{ [`${home}/test-cache`]: '/test-cache' }` and creates the folder.
- 2.3 `factory/src/stages/candidate.ts:18-40` (modify) — `playtestScript` runs `npm test` after `npm ci`, with no cache. Respects IV6.
- 2.4 `factory/src/cleanup.ts` (modify) — `sweepTestCache(root: string, now: Date, days: number) -> number` deletes cache files older than `days` and empty folders. `factory/src/tick.ts:380` calls it in `cleanWork()` and logs the count.
- 2.5 `factory/settings.env`, `factory/src/config.ts:70,88`, `factory/src/types.ts:64` (modify) — `FACTORY_TEST_CACHE_DAYS=14` as `testCacheDays`.
- 2.6 Docs (modify): `factory/docs/stages.md:43` for the checks and the candidate, `factory/docs/operations.md` for the cache and its sweep, `factory/docs/state.md` for the host folder.
- Tests: `checks` script and mount in the existing stage tests with the container fake, the candidate script runs `npm test`, `sweepTestCache` keeps fresh files and removes old ones, and config reads the key.
- Commit: `Checks run the cached game tests, and the candidate runs the full suite`

### Test strategy
- PH1 unit tests cover each case: a changed import, a changed read file, a file added to a read folder, a missing path that appears, a changed global input, an uncacheable read, a failed file never recorded, and a corrupt entry that throws.
- Verify runs the tool twice on the real suite in the game worktree, with no change in between. The second run must skip every cacheable file. Then it edits one data file and checks that only its dependents run. It also measures the overhead against plain `npm test` for AS3.

### Order & dependencies
- PH1 and PH2 run in parallel.
- Deploy order: PH1 merges into `dev` first, then PH2 merges into `main`. RK1 covers card branches that lack the script.

### Risks / rollback
- RK1 — Card branches cut before PH1 reached `dev`, and release-task branches until the next release cut, have no `test:cached` script, so their checks would fail on a missing script. Decision: `checkScript` checks for the script in `package.json`. Without it, checks run `npm test` and log `[checks] branch has no test:cached, full suite`. Remove this path once no open branch lacks the script.
- RK2 — A flaky test that passed once stays skipped while its inputs hold. The candidate's full suite catches it before a release.
- RK3 — A test that reads its inputs through a child process or the network escapes the fingerprint. The candidate catches it, and the fix is to add the call to the hook.
- Rollback: revert PH2 on `main`. The game script stays unused.

### Interfaces
- IF1 — `npm run test:cached -- --cache <dir>` in `game/`. It exits 0 only when every selected file passed, and it prints the `[test-cache]` count line.
- IF2 — The cache folder belongs to the tool. The factory only deletes files under it by mtime, and the tool touches an entry on each hit.

### Interface graph
- PH1 -> IF1, IF2 @ game/src/test/cache/, game/scripts/test-cache.mjs, game/package.json, game/CLAUDE.md
- PH2 IF1, IF2 -> @ factory/src/, factory/settings.env, factory/docs/

## Verify

Result: passed

Happy-path:
- CK1 — a cold run must cache every file and a warm run must skip them all — held: cold `ran 245, skipped 0, uncacheable 0` in 385 s, warm `ran 0, skipped 245` in 0.7 s.

Invariants / assumptions:
- CK2 (IV1) — a one-line change to `src/ui/style.css`, read through `fs`, must rerun its reader — held: only `condition-style.test.ts` ran.
- CK3 (IV1, IV2) — a new page in `docs/wiki/` must rerun the wiki test, and its failure must not be recorded — held: only `wiki.test.ts` ran, failed, and the tool exited 1. Without the page, the old pass matched again.
- CK4 (IV4) — a corrupt entry must fail loudly — held: exit 1 with `Corrupt test cache entry <path>`.
- CK5 (IV3) — agent containers must not get the cache mount — held: `agent()` in `container.ts` passes no mounts.
- CK6 — two runs sharing one cache at once must leave whole entries — held: no `.tmp` files left, and a third run skipped all 31 files.

Interfaces:
- CK7 (IF1, RK1) — a branch without `test:cached` must run the full suite and log it — held on the generated shell branch with two `package.json` files.

Smoke: `npm run test:cached -- --cache tmp/verify-cache` on the full game suite, cold then warm, as CK1.
Goal: proxy only. The real saving needs a few days of factory runs, measured like `tmp/testrep/`.
Notes: the in-container run is deferred, since the factory agent image is not on this Mac. The first checks run on the server shows whether the container user can write `/test-cache`.

## Conclusion

Outcome: built and verified locally on `test-cache-game` at `1242cff1` and `test-cache-factory` at `d56819b7`. The saving still needs a few days of factory runs after both merge.

Invariants:
- IV1 — CK2 and CK3: edits to a read file and a read folder reran only their readers.
- IV2 — CK3: a failed file was not recorded.
- IV3 — CK5.
- IV4 — CK4.
- IV5 — every run printed the count line.
- IV6 — the release playtest runs `npm test` before its run starts.

### Assumptions check
- AS1 — held on the local suite. `version.test.ts` reads git through a child process, which is the RK3 case.
- AS2 — held. The full suite gave 0 uncacheable files, and the fs hook caught wiki, CSS, model, map and snapshot reads.
- AS3 — see Verified by.
- AS4 — unverifiable until real factory runs.

### Unknowns outcome
- UK4 — still open. The full local cache was 2.1 MB for 245 entries, so size is no concern. The prune age is 14 days.

Review findings:
- Important: a failing suite in the release playtest spent a playtest run and blocked the release. Fixed in `d56819b7`. The suite runs before `startRun()` and after the run-limit check.

Future work:
- The checks redesign in [check-gates.md](check-gates.md): one cached suite run before the merge, and 5 fix rounds.

Verified by: the cold full-suite run took 385 s and the warm run 0.7 s. The in-container run waits for the first checks job on the server.

### Deviations from plan
- The uncached full suite runs in the release playtest, not the candidate. The candidate runs in the branch queue on 1 CPU with a 60 minute limit and holds up merges. The playtest runs in the verify queue on the release head, and the candidate builds only a commit it passed, so IV6 holds there. Commit `b2679ae8`.
- `globalKey()` leaves out `__GAME_VERSION__`, since it holds the commit hash and would miss every pass across commits. Only `hud-readout.test.ts` reads it, and not its value.
- `globalKey()` also hashes `scripts/test-cache.mjs`, so a runner change invalidates every pass.
