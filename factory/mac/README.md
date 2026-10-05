# Factory on the Mac

Run the factory on your Mac to test it before the server. The server setup is in [infra/README.md](../infra/README.md). Run every command from the repo root.

## Steps

1. Copy `factory/.env.example` to `factory/.env` and fill it in. Set `FACTORY_HOME` and `FACTORY_WEB_ROOT` to folders under your home, `FACTORY_PUBLIC_URL=http://localhost:8080` and `FACTORY_GPU=off`, since Docker on a Mac has no GPU.
2. Run `export FACTORY_UID=$(id -u)` in the shell you use for the compose commands. The Hermes compose file runs Hermes as that user.
3. Make the folders: `mkdir -p "$FACTORY_HOME"/{inbox,committee,state,logs,hermes} "$FACTORY_WEB_ROOT"`.
4. Build the images: `docker build -t "$FACTORY_IMAGE" factory/docker` and `docker build -t "$FACTORY_IMAGE-proxy" factory/docker/proxy`.
5. Start Hermes: `docker compose -f factory/hermes/compose.yaml --env-file factory/settings.env --env-file factory/.env up -d --build`.
6. Sign Hermes in to ChatGPT: `docker compose -f factory/hermes/compose.yaml --env-file factory/settings.env --env-file factory/.env run --rm --no-deps hermes hermes auth add openai-codex`. The login stays in `$FACTORY_HOME/hermes`.
7. Start the tick loop: `tmux new -s factory 'factory/mac/tick-loop.sh'`.
8. Serve the web root: `python3 -m http.server 8080 --directory "$FACTORY_WEB_ROOT"`.

## Watch and stop

- The tick log and the job logs are in `$FACTORY_HOME/logs/`.
- Stop the loop with Ctrl-C in its tmux window.
- Stop Hermes with the step 5 command, with `down` in place of `up -d --build`.
- After an edit to `factory/docker/proxy/allowlist`, rebuild the proxy image and run `docker rm -f roam-factory-proxy`. The next run starts a fresh proxy.
