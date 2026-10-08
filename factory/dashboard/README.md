# Factory dashboard

A read-only public page at `/factory/` that explains factory work. Overview shows activity, scheduling waits, release gates and server load. Analytics shows measured usage and time. Delivery shows how long issues take to reach dev, where they loop back and how often they are refused. Hermes's `factory_status` tool reads the same JSON from `/factory/api/snapshot`, so the page and Hermes never disagree. Visitors cannot start jobs or change state. `/factory/api/badges/<name>` serves the root README's live pills in the shields.io endpoint format: `release` counts the next release's features, and `building` counts open cards past triage. The code is in `src/dashboard/`, and the page in this folder.

## Local use

From `factory/`:

1. Run `npm ci` and copy `dashboard/.env.example` to `dashboard/.env`. It also reads `settings.env` and `.env`.
2. Set `DASHBOARD_PORT`, or `DASHBOARD_SOCKET` for an absolute socket path.
3. Leave `DASHBOARD_CHANNEL_URL` empty to get the link of `FACTORY_PUBLIC_CHANNEL` from the bot, or set `DASHBOARD_HIDE_TELEGRAM=1` to show no channel.
4. Run `npm run dashboard` and open `http://127.0.0.1:8787/factory/`. GitHub reads need `gh` logged in.

## What the numbers mean

- Job outcomes, durations, costs and tokens come from the factory ledger. Older lines have cost but no tokens, and a missing count shows as unavailable, never as zero.
- The 24-hour, 7-day and 30-day ranges are rolling UTC windows. Hermes chat, agent runs outside the factory and hosting costs are not counted.
- Cards waiting is the average number of cards held back at once over the measured clock time. A card that waits behind its own running job does not count. Its tooltip and the stage bars show summed card-time, so 20 cards waiting for one hour count as 20 hours. Worker time sums the same way across parallel jobs. Gaps longer than three ticks are left out of both and counted.
- Runner heartbeats show a job is alive. Agent activity reports are labelled apart and never prove a check passed. Scheduler explanations come from job selection.
- A factory script, like the release playtest's suite and plays or a build, prints each step as it starts and its phase. So a worker shows the substep that runs, never `npm ci` for a whole script, and a phase shows only while its script runs. Each step counts as progress.
- CPU, container CPU, memory, GPU and disk readings are whole-host percentages. A reading that fails or is not supported shows as unavailable.
- A pause shows as an amber banner from the pause file. Raw pause notes never leave the server.
- While `DASHBOARD_HIDE_TELEGRAM=1`, the API returns no channel link or posts.

Agents report their phase with `factory-status <activity>`, with no free text. `FACTORY_OBSERVATION_HEARTBEAT_MS` and `FACTORY_OBSERVATION_MAX_EVENT_BYTES` in `settings.env` set the liveness sampling and the event size limit.

## Delivery numbers

The Delivery tab reads only the card lines of the ledger. The board shows where a card is now, and job lines give worker time, so neither tells when a card entered a column. The tab shows nothing for history before the first card line, and states when that was.

- Time in stage is calendar time from the move into a stage to the next move out, waits included. It is never worker time, which Analytics shows. Testing is the preview, Hardening the harden stage and Merging the merge queue. Older lines, written before the Merging column, count Approval after hardening or `factory merge` as the merge queue. A `factory move` into Testing counts as preview.
- A stage counts in a range when it ended in that range. Stages still open are counted with their mean age and are not in the means.
- Issue to dev runs from the day the issue was opened to its first merge into dev, the moment GitHub shows the label `release-candidate` added. Weekly Ship is not its end. Votes and triage waits are inside it. Issues merged in the range count. Release tasks and ad hoc tasks are left out, because the factory opens them itself. It reads GitHub, so it covers merges from before card records began.
- In flight counts cards that triage accepted and that are not yet merged or closed. It starts at the first triage acceptance, so it needs card records. A merge with no recorded acceptance is counted apart.
- Loops count each move back by its transition, with the cards it touched. The loop rate is cards with a loop over cards with any move in the range.
- Failed job retries count card jobs that failed, died or timed out. The tick runs those again in the same column, so they are not loops. A job a control order stopped is no retry.
- Each rejection rate has its own base: triage refusals over triage decisions, design refusals over design decisions, and Deny over committee approvals and denials. Each card counts once per gate, by its latest decision in the range. Pending cards, failed jobs, patches, redesigns, removals and operator drops are not rejections.
- Hotfixes, release tasks, the release card and ad hoc tasks run other paths, so they are left out and counted.
- A line equal to the card's previous line is a copy from a resumed job or a repeated tick, and is dropped. A move into the column the card is in starts no new stage.
- Card lines stay 180 days in the dashboard's memory. A card that moved before the first card line is counted as joined before records.

## Production

Code reaches the server with every merge into `main`. The service and its Caddy route need a one-time install from `factory/infra/` with `uv run pyinfra -y inventory.py deploy/dashboard.py`. It installs `roam-factory-dashboard.service` with Telegram hidden and updates Caddy. It does not restart Hermes or stop jobs. Rerunning it resets Telegram to hidden.

The service listens on `/opt/factory/dashboard/http.sock`, and Caddy proxies `/factory/` to it. Each deploy of `main` restarts it.

Check it after an install:

- `systemctl status roam-factory-dashboard.service` and `/opt/factory/home/logs/dashboard.log`.
- `https://<domain>/factory/health` answers, and `https://<domain>/factory/` updates through `/factory/api/events`.
- A `POST` returns 405, and a private path returns 404.

## Staying in step with the factory

- The page's words for columns, job stages, queues, activities, wait reasons, delivery stages, loops and gates live in `src/dashboard/labels.ts`. Each list is keyed by the factory's own type, so a new column, stage, queue, activity or wait reason fails `npm run typecheck` until it has a label. The snapshot carries the labels to the page, and a key with no label shows as itself.
- `dashboard.js` is type-checked by `dashboard/tsconfig.json` against the server's `Snapshot` type. A field the server renames or drops fails the check.
- The funnel and the card counts follow the labels, so a new column needs no CSS or page edit.
- A commit that touches this folder or `src/dashboard/` runs the browser check below in the pre-commit hook.

## Browser check

From the repo root, with root, factory and game dependencies installed, this runs the page against fixtures with no network. It checks desktop fit, pagination, live updates, keyboard use, missing data and escaped markup. The image must match the installed Playwright version.

```sh
mkdir -p tmp/browser-evidence
docker run --rm --init --network none --memory 2g --cpus 2 --shm-size 512m --mount type=bind,src="$PWD",dst=/work,readonly --mount type=bind,src="$PWD/tmp/browser-evidence",dst=/evidence --workdir /work mcr.microsoft.com/playwright:v1.63.0-noble node factory/dashboard/browser.test.mjs /work/game/node_modules/playwright/index.mjs /evidence
```

The bundled Barlow Semi Condensed and IBM Plex Mono fonts use the SIL Open Font License, with their licenses in `fonts/`.
