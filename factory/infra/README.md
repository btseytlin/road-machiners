# Factory infra

A pyinfra project that sets up the one Ubuntu 24.04 machine that runs the factory. The machine is a home laptop with a GTX 1660 Ti, dual booted with Windows, at `192.168.1.93` on the home network. It takes no inbound traffic but ssh. Players reach it through a Cloudflare Tunnel, which dials out.

Run every command from `factory/infra`, in the main checkout. Git ignores `prod.env` and `server.env`, so a worktree has none. In a worktree, link them with `ln -s <main checkout>/factory/infra/prod.env prod.env` and the same for `server.env`.

## Host needs

- 8 cores, since the CPU pool shares in `settings.env` assume 8. A smaller host needs lower shares, or every job start fails.
- 8 GB of memory. A checks run peaks near 2.6 GB and Hermes idles near 300 MB. Provision adds 4 GB of swap.
- IPv4 out, since GitHub has no IPv6.

## Commands

- `uv run pyinfra -y inventory.py deploy/provision.py` sets up the host. Run it once and after host changes.
- `uv run pyinfra -y inventory.py deploy/deploy.py` sets up the factory. Run it to roll out a secret, an infra change or a new `FACTORY_TICK_MINUTES`.
- `uv run pyinfra -y inventory.py deploy/dashboard.py` installs the public dashboard and its Caddy route. Run it after deploy.
- `uv run pyinfra -y inventory.py deploy/status.py` reads the host state and changes nothing.
- `uv run pytest` tests the pure helpers.

Factory code and other settings roll out by a merge into `main`. The server deploys them by itself.

## What each deploy does

- Provision installs Docker, Node 24, gh, butler, the NVIDIA driver and the NVIDIA container toolkit, and checks that a container sees the GPU. It opens port 22 only, stops the lid and idle timers from suspending the laptop, and makes the `factory` user and the `/opt/factory` folders.
- Deploy clones `main` into `/opt/factory/repo` once and never sends code after that. It runs `factory-layout.sh`, which makes the first release and its links.
- Deploy pushes the server-only env to `/opt/factory/factory.env` with mode 600. `FACTORY_ENV_FILE` in `prod.env` names its source on your machine. Each release links `factory/.env` to it.
- Deploy builds the agent image and the egress proxy image, and installs the tick timer, the `factory-update` timer and the dashboard restart hook.
- Deploy starts Hermes, Caddy and the Cloudflare Tunnel with Docker Compose. Caddy serves `/opt/factory/www` over plain HTTP to the tunnel, and Cloudflare serves HTTPS.
- Deploy stops early when the factory `.env` has the wrong `FACTORY_HOME` or `FACTORY_WEB_ROOT`, or when a key is in both `.env` and `settings.env`.
- Deploy ends with `check-ports.sh`, which fails on any published Docker port. Docker skips UFW for published ports, so none may exist.

## How main reaches the server

`/opt/factory/factory-update.sh` runs every 2 minutes as the factory user. Its log is `/opt/factory/home/logs/update.log`.

- When `main` is past the commit in `/opt/factory/home/deployed`, it builds the new commit in `/opt/factory/releases/<sha>`, a worktree of `repo`, and runs `npm ci`. It rebuilds the images when `factory/docker/` changed, and Hermes when `factory/hermes/` or `settings.env` changed.
- It swaps the link `releases/current` in one step. It never pauses the factory or stops a job, and a tick and its jobs run on one release to their end.
- It removes each old release that no process works in. The previous release stays one more deploy.
- A local edit in the current release or a failed build stops it, with the reason in `/opt/factory/home/update-failed`. Hermes's incident watch reports that file.
- The script lives outside the releases, so a change to it needs a deploy.

## Agent network

- Agent containers run on the internal Docker network `roam-factory-agents`, which has no route out. The container `roam-factory-proxy` is their only way out.
- The proxy allows only the hosts in `factory/docker/proxy/allowlist`, so an injected agent cannot send its token elsewhere. Change it by a merge into `main`.
- A collaborator can label an issue `open-network`. Its agent then runs on the normal network with no proxy.

## Folders on the server

- `/opt/factory/repo` is the git clone. `/opt/factory/code` links to `releases/current`, and the factory runs from `/opt/factory/code/factory`. Never edit a release by hand.
- `/opt/factory/home` is `FACTORY_HOME`, and `/opt/factory/www` is `FACTORY_WEB_ROOT`.
- `/opt/factory/hermes` holds the Hermes state and login. Hermes runs as the factory user, uid 1001, and has ssh access to the server as that user.

## First-time steps

1. In the BIOS, turn Secure Boot off and set power-on after AC loss. Install Ubuntu Server 24.04 beside Windows with OpenSSH. Make Ubuntu the GRUB default with a short timeout, and give the laptop a fixed address. Check the GRUB default after a big Windows update.
2. Add the domain to Cloudflare. In Zero Trust, make a tunnel and copy its token. Add the public hostnames `<domain>` and `www.<domain>`, both to `http://caddy:80`. Turn on Always Use HTTPS.
3. Copy `prod.env.example` to `prod.env` and fill it in.
4. Make a classic GitHub token for the bot account with `repo` and `project`, and put it in `FACTORY_GH_TOKEN`.
5. Put the output of `claude setup-token` in `CLAUDE_CODE_OAUTH_TOKEN` in the factory `.env`.
6. Make a Telegram bot with BotFather. In the factory `.env`, set `TELEGRAM_BOT_TOKEN`, `FACTORY_COMMITTEE_BOOTSTRAP` to your Telegram id, `FACTORY_COMMITTEE_BOOTSTRAP_GITHUB` to your GitHub login and `FACTORY_COMMITTEE_CHAT`. Make the bot an admin of the committee group, or Telegram withholds mentions from it.
7. In the factory `.env`, set `FACTORY_HOME=/opt/factory/home`, `FACTORY_WEB_ROOT=/opt/factory/www`, `FACTORY_PUBLIC_URL=https://<domain>`, `FACTORY_GPU=on` and `BUTLER_API_KEY`.
8. Set `FACTORY_ENV_FILE` in `prod.env` to that file. Run provision, reboot when it asks, and run it again until it passes. Then run deploy.
9. Sign Hermes in to ChatGPT on the server: `cd /opt/factory/code && FACTORY_HERMES_DIR=/opt/factory/hermes FACTORY_UID=1001 docker compose -f factory/hermes/compose.yaml --env-file factory/settings.env --env-file factory/.env run --rm --no-deps hermes hermes auth add openai-codex`. Then run `docker restart factory-hermes`.
10. Run status, then open `https://<domain>/dev/`.

## Moving to another server

Two Hermes gateways must never run on one bot token.

1. On the old server, create `/opt/factory/home/paused` and wait until status shows no running job. Run `systemctl stop roam-factory-tick.timer roam-factory-update.timer` and `docker stop factory-hermes`.
2. Run provision on the new host, but not deploy.
3. Copy `/opt/factory/home`, `/opt/factory/hermes` and `/opt/factory/www` with `rsync -aH`.
4. Run deploy, remove the pause file on the new host and check status. Shut the old server down after a full tick passed on the new one.
