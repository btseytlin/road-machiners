# Factory infra

pyinfra project for one Ubuntu 24.04 machine that runs the game factory. The machine is a laptop at home with a GTX 1660 Ti, dual booted with Windows.

The host needs at least 4 cores and 8 GB. With 2 cores, the full game test suite takes over 9 minutes and its long tests time out. The testing gate peaks near 2.6 GB, Hermes idles near 300 MB, and provision adds 4 GB of swap for spikes. The host needs IPv4 out, since GitHub has no IPv6. It takes no inbound traffic but ssh. The public domain reaches it through a Cloudflare Tunnel, which dials out.
It follows `Steelman/infra`. Run every command from `factory/infra`.

The host is the laptop at `192.168.1.93`, and it is reachable only from the home network. Run pyinfra from the main checkout, where `prod.env` and `server.env` live. Git ignores both files, so a worktree has none. In a worktree, link them with `ln -s <main checkout>/factory/infra/prod.env prod.env` and the same for `server.env`. Check the link with the status command below.

## Layout

    inventory.py         host from prod.env
    factory_infra/       settings and the check of the factory .env and settings.env
    deploy/              provision.py, deploy.py, dashboard.py, status.py
    files/               systemd units and config pushed to the host
    stacks/caddy/        compose file of Caddy and the tunnel, and the Caddyfile
    prod.env.example     copy to prod.env

## Commands

- Set up the host, once and after host changes: `uv run pyinfra -y inventory.py deploy/provision.py`
- Set up the factory, and roll out a new secret or an infra change: `uv run pyinfra -y inventory.py deploy/deploy.py`
- Install the public dashboard service and its Caddy route, once and after a change to either: `uv run pyinfra -y inventory.py deploy/dashboard.py`. Run it after the factory is deployed, since it links into the current release.
- Roll out factory code or settings: merge them into `main` on GitHub. The server deploys them by itself.
- Read the host state, changes nothing: `uv run pyinfra -y inventory.py deploy/status.py`
- Test the pure helpers: `uv run pytest`

## What each deploy does

- Provision installs packages, Docker, Node 24, gh and butler. It opens port 22 only. It stops the lid and idle timers from suspending the laptop. It installs the NVIDIA driver that `ubuntu-drivers` recommends for the card, and the NVIDIA container toolkit, and checks that a container sees the GPU. It makes the `factory` user and the `/opt/factory` folders.
- Deploy clones `main` into `/opt/factory/repo` once. It never sends code after that.
- Deploy runs `factory-layout.sh`, which makes the first release, the links and runs its `npm ci`. On a server that still has a real `/opt/factory/code` folder, it stops the timers, moves that folder to `repo` and its `.env` to `factory.env`, then makes the layout. Running jobs keep working, since a moved folder stays their working folder.
- Deploy pushes the server-only factory env to `/opt/factory/factory.env` with mode 600. Each release links `factory/.env` to it. It holds the secrets, the committee ids and the host paths. `FACTORY_ENV_FILE` in `prod.env` names its source on your machine. Every other setting is in the tracked `factory/settings.env`.
- Deploy sets git to use gh for credentials and builds the agent image and the egress proxy image `<FACTORY_IMAGE>-proxy`.
- Deploy installs the tick service and timer. The timer runs `factory tick` from `/opt/factory/code/factory` every `FACTORY_TICK_MINUTES`.
- Deploy installs `factory-update` with its timer, which runs every 2 minutes. See below.
- Deploy starts Hermes, Caddy and the Cloudflare Tunnel with Docker Compose. Caddy serves `/opt/factory/www` over plain HTTP to the tunnel. Cloudflare serves HTTPS to players. Deploy writes the tunnel token to `/opt/factory/tunnel.env` with mode 600.
- Deploy stops early when the factory `.env` has the wrong `FACTORY_HOME` or `FACTORY_WEB_ROOT`, or when a key is in both `.env` and `settings.env`.

## How main reaches the server

`/opt/factory/factory-update.sh` runs as the factory user from `roam-factory-update.timer`. Its log is `/opt/factory/home/logs/update.log`.

- It fetches `main`. When `main` is past the commit in `/opt/factory/home/deployed`, it deploys it.
- It builds the new commit beside the running one in `/opt/factory/releases/<sha>`, a git worktree of `repo`, links its `.env` and runs `npm ci`. It builds the images when `factory/docker/` changed, and rebuilds Hermes when `factory/hermes/` or `settings.env` changed.
- It then swaps the link `releases/current` in one step and records the commit in `deployed`. It never pauses the factory, never waits for a job and never stops one. A tick resolves the link when it starts, so a tick and the jobs it starts run on one release to their end.
- It removes each old release that no process works in, read from `/proc/*/cwd`. The previous release stays one more deploy, for a tick that read the link just before the swap. A release it cannot remove stays for the next deploy.
- A local edit in the current release stops it. A failed build removes the half-built release and leaves `current` as it was, and the next run tries again. Both write the reason to `/opt/factory/home/update-failed`, which Hermes's incident watch prints.
- The script lives outside the releases, so a change to it needs a deploy.
- Docker skips UFW for published ports. So `daemon.json` binds published ports to 127.0.0.1 unless a port names its address. No container needs a published port, since the tunnel reaches Caddy on the stack's network. Deploy ends with `check-ports.sh`, which fails on any published port. Status lists the published ports.

## Agent network

- Agent and shell containers run on the internal Docker network `roam-factory-agents`, which has no route out. The container `roam-factory-proxy` is their only way out. The factory creates the network and starts the proxy before a run.
- The proxy allows only the hosts in `factory/docker/proxy/allowlist`, with a comment per host. Everything else fails. So an injected agent cannot send its token to another host.
- To change the allowlist, edit that file and merge it into `main`. The update rebuilds the proxy image, and the next run starts a fresh proxy.
- A collaborator can label an issue `open-network`. Its agent then runs on the normal network with no proxy.

## Folders on the server

- `/opt/factory/repo` is the git clone. `/opt/factory/releases/<sha>` holds one deployed commit each. `/opt/factory/code` links to `releases/current`, which links to the deployed release. The factory runs from `/opt/factory/code/factory`. Never edit a release by hand.
- `/opt/factory/factory.env` is the server-only env.
- `/opt/factory/home` is `FACTORY_HOME`. Set it in the factory `.env`.
- `/opt/factory/www` is `FACTORY_WEB_ROOT`. Set it in the factory `.env`.
- `/opt/factory/hermes` holds the Hermes state and login.
- Hermes runs as the factory user, uid 1001. It writes the inbox and the committee file, and the tick reads and deletes inbox files.
- Hermes also has ssh access to the server as the factory user, so it can run factory steps, Docker builds and deploys. Deploy makes its key in `/opt/factory/hermes/.ssh` and adds it to the factory user's `authorized_keys`.
- The `committee` folder has the same owner, group and mode. Hermes writes `committee.json` there. The tick only reads it.

## First-time steps

1. In the laptop's BIOS, turn Secure Boot off and set the machine to power on after AC loss, if it has that option. Install Ubuntu Server 24.04 beside Windows, on free space, with OpenSSH. Make Ubuntu the GRUB default with a short timeout, so a power cut boots back into the factory. Give the laptop a fixed address on the home network. Check the GRUB default after a big Windows update.
2. Add the domain to Cloudflare and move its nameservers there. In Zero Trust, make a tunnel and copy its token from the Docker install command. Add two public hostnames, the domain and `www.<domain>`, both to the service `http://caddy:80`. Turn on Always Use HTTPS under SSL/TLS, Edge Certificates.
3. Copy `prod.env.example` to `prod.env` and fill it in. `FACTORY_HOST` is the laptop's home address.
4. Make a classic GitHub token for the bot account with `repo` and `project`. Put it in `FACTORY_GH_TOKEN`. Deploy adds it to the server's factory env as `GH_TOKEN`, so `gh` and git pushes use it with no `gh` login.
5. Run `claude setup-token` on any machine you are logged in to. Put the result in `CLAUDE_CODE_OAUTH_TOKEN` in the factory `.env`.
6. Make a Telegram bot with BotFather. Put its token in `TELEGRAM_BOT_TOKEN`. Set `FACTORY_COMMITTEE_BOOTSTRAP` to your Telegram user id, `FACTORY_COMMITTEE_BOOTSTRAP_GITHUB` to your GitHub login and `FACTORY_COMMITTEE_CHAT` to the chat id in the factory `.env`. You are the first committee member. Add others with `/committee add` in the chat. Make the bot an admin of the committee group. Otherwise Telegram withholds @mentions from it, and only replies to its posts reach Hermes.
7. In the factory `.env`, set `FACTORY_HOME=/opt/factory/home`, `FACTORY_WEB_ROOT=/opt/factory/www`, `FACTORY_PUBLIC_URL=https://<domain>`, `FACTORY_GPU=on` and `BUTLER_API_KEY`. Check the values in `factory/settings.env`, like `FACTORY_TICK_MINUTES` and `ITCH_TARGET`.
8. Set `FACTORY_ENV_FILE` in `prod.env` to that file. Run provision. The first run installs the NVIDIA driver and stops with a request to reboot. Reboot the laptop and run provision again until it passes. Then run deploy.
9. Sign Hermes in to ChatGPT, which it uses for chat. Run this on the server: `cd /opt/factory/code && FACTORY_HERMES_DIR=/opt/factory/hermes docker compose -f factory/hermes/compose.yaml --env-file factory/settings.env --env-file factory/.env run --rm --no-deps hermes hermes auth add openai-codex`. Then restart Hermes with `docker restart factory-hermes`.
10. Run status and check the timer, Hermes health, the gh login, the tunnel and the GPU. Open `https://<domain>/dev/` in a browser.

## Moving from another server

The factory state lives in three folders. Copy them, so open cards, posts and the Hermes login carry over.

1. On the old server, make the file `/opt/factory/home/paused` and wait until status shows no running job. Stop its timers and Hermes with `systemctl stop roam-factory-tick.timer roam-factory-update.timer` and `docker stop factory-hermes`. Two Hermes gateways must never run on one bot token.
2. Run provision on the new host, but not deploy yet.
3. Copy `/opt/factory/home`, `/opt/factory/hermes` and `/opt/factory/www` to the new host with `rsync -aH`, keeping owners and modes.
4. Run deploy. It starts the timers and Hermes on the copied state. Remove `/opt/factory/home/paused` on the new host. Check status. Shut the old server down only after a full tick passed on the new one.

Do not start a second Hermes gateway for the same bot token. The one-off container above only runs the login command.
