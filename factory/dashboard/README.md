# Factory dashboard

A read-only public page at `/factory/` that explains factory work. Overview shows activity, scheduling waits, release gates and server load. Analytics shows measured usage and time. Hermes's `factory_status` tool reads the same JSON from `/factory/api/snapshot`, so the page and Hermes never disagree. Visitors cannot start jobs or change state. The code is in `src/dashboard/`, and the page in this folder.

## Local use

From `factory/`:

1. Run `npm ci` and copy `dashboard/.env.example` to `dashboard/.env`. It also reads `settings.env` and `.env`.
2. Set `DASHBOARD_PORT`, or `DASHBOARD_SOCKET` for an absolute socket path.
3. Set `DASHBOARD_HIDE_TELEGRAM=1` and leave `DASHBOARD_CHANNEL_URL` empty, since the factory has no separate public channel yet.
4. Run `npm run dashboard` and open `http://127.0.0.1:8787/factory/`. GitHub reads need `gh` logged in.

## What the numbers mean

- Job outcomes, durations, costs and tokens come from the factory ledger. Older lines have cost but no tokens, and a missing count shows as unavailable, never as zero.
- Review rounds count under Verify, since their ledger job is Verify.
- The 24-hour, 7-day and 30-day ranges are rolling UTC windows. Hermes chat, agent runs outside the factory and hosting costs are not counted.
- Waiting time sums the intervals a task spent not running. Gaps longer than three ticks are left out and counted.
- Runner heartbeats show a job is alive. Agent activity reports are labelled apart and never prove a check passed. Scheduler explanations come from job selection.
- CPU, container CPU, memory, GPU and disk readings are whole-host percentages. A reading that fails or is not supported shows as unavailable.
- A pause shows as an amber banner from the pause file. Raw pause notes never leave the server.
- While `DASHBOARD_HIDE_TELEGRAM=1`, the API returns no channel link or posts.

Agents report their phase with `factory-status <activity>`, with no free text. `FACTORY_OBSERVATION_HEARTBEAT_MS` and `FACTORY_OBSERVATION_MAX_EVENT_BYTES` in `settings.env` set the liveness sampling and the event size limit.

## Production

Code reaches the server with every merge into `main`. The service and its Caddy route need a one-time install from `factory/infra/` with `uv run pyinfra -y inventory.py deploy/dashboard.py`. It installs `roam-factory-dashboard.service` with Telegram hidden and updates Caddy. It does not restart Hermes or stop jobs. Rerunning it resets Telegram to hidden.

The service listens on `/opt/factory/dashboard/http.sock`, and Caddy proxies `/factory/` to it. Each deploy of `main` restarts it.

Check it after an install:

- `systemctl status roam-factory-dashboard.service` and `/opt/factory/home/logs/dashboard.log`.
- `https://<domain>/factory/health` answers, and `https://<domain>/factory/` updates through `/factory/api/events`.
- A `POST` returns 405, and a private path returns 404.

## Browser check

From the repo root, with root, factory and game dependencies installed, this runs the page against fixtures with no network. It checks desktop fit, pagination, live updates, keyboard use, missing data and escaped markup. The image must match the installed Playwright version.

```sh
mkdir -p tmp/browser-evidence
docker run --rm --init --network none --memory 2g --cpus 2 --shm-size 512m --mount type=bind,src="$PWD",dst=/work,readonly --mount type=bind,src="$PWD/tmp/browser-evidence",dst=/evidence --workdir /work mcr.microsoft.com/playwright:v1.63.0-noble node factory/dashboard/browser.test.mjs /work/game/node_modules/playwright/index.mjs /evidence
```

The bundled Barlow Semi Condensed and IBM Plex Mono fonts use the SIL Open Font License, with their licenses in `fonts/`.
