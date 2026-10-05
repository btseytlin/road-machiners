# Factory dashboard

The read-only dashboard explains factory work at `/factory/`. Overview shows activity, scheduling waits, release gates and server load. Analytics shows measured usage and time. Hermes's `factory_status` tool reads the exact JSON from `/factory/api/snapshot` that feeds both tabs. It has no separate status calculation. Visitors cannot start jobs or change state.

## Local use

From `factory/`, run `npm ci`, copy `dashboard/.env.example` to `dashboard/.env`, and set a port or absolute socket path. Set `DASHBOARD_HIDE_TELEGRAM=1` and leave `DASHBOARD_CHANNEL_URL` empty while the factory has no separate public Telegram channel. To enable posts later, configure a different `FACTORY_PUBLIC_CHANNEL`, clear the hide flag and set the public `DASHBOARD_CHANNEL_URL` or resolve it through Telegram's `getChat` API. Run `npm run dashboard` and open `http://127.0.0.1:8787/factory/`. GitHub reads require `gh` authentication and a public repository.

## Measurements and privacy

- The existing factory ledger owns job outcomes, durations and CLI cost estimates. New agent entries also record final whole-tree `modelUsage` token totals. Analytics groups total, input including cache, and output tokens in one panel. The stage-by-model table has separate input including cache and output columns for each model. Focus an input cell for exact cache counts and cost. Review rounds count under Verify because their ledger job is Verify. The Tokens counter and daily Tokens chart sum all four categories. Older ledger entries have cost but no token counts. Missing token counts display as unavailable, not zero.
- The 24-hour, seven-day and thirty-day ranges use rolling UTC windows. The first ledger timestamp marks the start of available history. Daily spend opens on Cost, so older cost-only entries remain visible. Days before that timestamp have no recorded spend or token measurement. Worker time sums completed job durations, including concurrent workers separately. Factory-managed usage excludes Hermes chat, external agent runs, audio and hosting charges. Resumed cumulative sessions contribute only their additional reported usage. Repeat attempts group time and cost by their previous outcome.
- Waiting time sums observed non-running task intervals, once per task and stage even when several reasons apply. Gaps beyond three tick intervals are excluded and counted. Older history has no waiting measurements. Daily charts distinguish missing measurements from zero.
- The funnel counts public GitHub board cards even while scheduling is paused. Missing or stale GitHub data stays unavailable rather than showing zero. Runner heartbeats establish liveness. Completed operations establish progress. Agent activity reports are labelled separately and do not prove a successful check. Scheduler explanations come from job selection, not dashboard inference. Hermes hooks report safe categories, with optional intent from `factory_report_activity`.
- CPU uses host counter changes. Container CPU uses Docker measurements divided by the host CPU count, so both use whole-host percentages. Container labels associate measurements with workers or Hermes. Linux RAM uses `MemAvailable`. GPU requires `nvidia-smi`. SSD describes the filesystem containing `FACTORY_HOME`. Host-process attribution, CPU-pool pressure and GPU ownership are not measured. Unsupported or failed readings stay unavailable, and attributed totals need not equal host totals.
- The dashboard has no Telegram panel. While `DASHBOARD_HIDE_TELEGRAM=1`, the API returns no channel link or posts. If enabled separately, the API includes only records tagged with the configured public chat. Untagged records and other chats stay excluded.
- The collector reads the ledger incrementally. It retains up to thirty days of records in memory. A failed source keeps its last successful snapshot with a stale marker. Stream clients that cannot drain one full snapshot skip updates until ready rather than reconnect on each broadcast.

## Display and reporting

A pause appears in an amber banner on both tabs, directly from the pause file rather than the last scheduler tick. The recognized Hermes Claude weekly-limit note becomes a fixed public reason with its next decision. Other pause notes show an operator pause with no public reason recorded. Raw notes never leave the server. Free slots show that starts are paused instead of claiming no eligible work.

Overview fits 1440×900 and 1366×768 at normal zoom. The release panel shows the number of changes and three linked issues per page instead of one clipped title list. Server readings name known services and group unnamed containers. Growing lists use counted pagination. Narrow screens scroll instead of hiding panels. Focus truncated text to read it, then press Enter to focus its full-text view and Escape to return. Tabs support arrow keys. Analytics counters expose exact values on focus.

`FACTORY_OBSERVATION_HEARTBEAT_MS` and `FACTORY_OBSERVATION_MAX_EVENT_BYTES` in `settings.env` control liveness sampling and structured-event bounds. `factory-status <activity>` lets workers report a phase change without free text. Native Hermes hooks supply manager activity. The standard updater rebuilds both images when their source changes. Existing workers continue on their original release, so their new readings can remain unavailable until later jobs start.

## First production installation

After a dashboard code change reaches `main`, the standard updater installs the new release. Infrastructure is a separate operation. From `factory/infra/`, run `uv run pyinfra -y inventory.py deploy/dashboard.py` with the existing `prod.env` and host credentials. This dashboard-only operation configures Telegram as hidden, installs its systemd service and restart hook, and updates only Caddy. It does not rebuild agent images, restart Hermes, stop factory jobs or replace the tunnel. To enable a future public channel, update the persistent dashboard configuration explicitly instead of rerunning this hidden-channel installer.

The dashboard listens on `/opt/factory/dashboard/http.sock`. Caddy mounts this directory read-only and proxies `/factory/` to the socket. The existing root redirect and game build paths stay in Caddy. Later main updates create a release-local link to the persistent dashboard configuration and restart the dashboard after switching releases. A failed dashboard restart leaves the updater's restart marker for inspection. The factory release swap still follows its existing rules.

Check `systemctl status roam-factory-dashboard.service`, `/opt/factory/home/logs/dashboard.log`, `https://<domain>/factory/health` and `https://<domain>/factory/` after installation. The public page should update through `/factory/api/events`. A `POST` must return 405 and a private path must return 404. Deployment requires a reachable host. Tests do not establish live service health.

## Browser checks

From the repository root, with root, factory and game dependencies installed, run the isolated fixture check below. The image must match the installed Playwright version. It reads the checkout, writes screenshots only under `tmp/browser-evidence`, and has no network access. It tests desktop fit, pagination, live updates, keyboard details, missing data and escaped markup.

```sh
mkdir -p tmp/browser-evidence
docker run --rm --init --network none --memory 2g --cpus 2 --shm-size 512m --mount type=bind,src="$PWD",dst=/work,readonly --mount type=bind,src="$PWD/tmp/browser-evidence",dst=/evidence --workdir /work mcr.microsoft.com/playwright:v1.63.0-noble node factory/dashboard/browser.test.mjs /work/game/node_modules/playwright/index.mjs /evidence
```

## Fonts

The bundled Barlow Semi Condensed and IBM Plex Mono fonts use the SIL Open Font License. Their license files are under `fonts/`.
