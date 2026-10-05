# Factory on the Mac

Use this to test the factory on your Mac before the server.
The server setup is in `factory/infra/README.md`.

## Steps

Run every command from the repo root, unless a step says otherwise.

1. Copy `factory/.env.example` to `factory/.env`. Fill in the factory keys. Set `FACTORY_HOME` to a folder under your home, for example `/Users/you/factory-home`. Set `FACTORY_WEB_ROOT` to a folder too. Set `FACTORY_GPU=off`, since Docker on a Mac has no GPU. The other settings, like `FACTORY_TICK_MINUTES`, are in `factory/settings.env`.
2. Make the folders. Run `mkdir -p "$FACTORY_HOME"/{inbox,committee,state,logs,hermes} "$FACTORY_WEB_ROOT"` with those values set.
3. Build the agent image and the egress proxy image. Run `docker build -t "$FACTORY_IMAGE" factory/docker` and `docker build -t "$FACTORY_IMAGE-proxy" factory/docker/proxy`.
4. Start Hermes. Run `docker compose -f factory/hermes/compose.yaml --env-file factory/settings.env --env-file factory/.env up -d --build`.
5. Sign Hermes in to ChatGPT, which it uses for chat. Run `docker compose -f factory/hermes/compose.yaml --env-file factory/settings.env --env-file factory/.env run --rm --no-deps hermes hermes auth add openai-codex`. The login stays in `$FACTORY_HOME/hermes`.
6. Start the tick loop in tmux. Run `tmux new -s factory 'factory/mac/tick-loop.sh'`.
7. Serve the web root. Run `python3 -m http.server 8080 --directory "$FACTORY_WEB_ROOT"`. Set `FACTORY_PUBLIC_URL` to `http://localhost:8080`.

## Committee

- `FACTORY_COMMITTEE_BOOTSTRAP` and `FACTORY_COMMITTEE_BOOTSTRAP_GITHUB` name the first member. That member is the whole committee until `$FACTORY_HOME/committee/committee.json` exists.
- Members manage the list in the chat. `/committee list` shows it. `/committee add`, `/committee remove` and `/committee github` change it.
- The bot answers committee members only.

## Watch and stop

- The tick log is `$FACTORY_HOME/logs/tick.log`. Job logs are in the same folder.
- Stop the loop with Ctrl-C in its tmux window.
- Stop Hermes with `docker compose -f factory/hermes/compose.yaml --env-file factory/settings.env --env-file factory/.env down`.

## Agent network

- Agents run on the internal Docker network `roam-factory-agents`. The container `roam-factory-proxy` is their only way out. The factory starts both before a run.
- The proxy allows only the hosts in `factory/docker/proxy/allowlist`. After you edit it, rebuild the proxy image and run `docker rm -f roam-factory-proxy`. The next run starts a fresh proxy.
- A collaborator can label an issue `open-network`. Its agent then runs on the normal network with no proxy.
