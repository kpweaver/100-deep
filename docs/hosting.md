# Hosting Thangorodrim online

Status: **groundwork**. Hosted mode is implemented and tested (`npm run
test:bridge`), and a Docker image is defined. The image has not yet been built
in CI (Docker wasn't available where it was written), and there are no
accounts yet.

## How hosted mode works

`THANG_MODE=hosted` (or `node bridge/src/index.ts --hosted`) turns the bridge
into a multi-player server:

- Each browser gets an anonymous **session token**, a random 128-bit hex
  string. The client stores it in `localStorage` and resumes with it. The
  token is the only key to that player's save, so treat it like a password
  (see Accounts below).
- Each session has its own save directory (`$THANG_DATA/sessions/<token>/`)
  and its own **engine process**. Games are fully isolated: the engine is
  the unmodified single-player Angband core.
- **Capacity:** at most `THANG_MAX_SESSIONS` engines run at once. Extra
  players get a "server is full" message.
- **Idle games:** when a player disconnects, their game keeps running for
  `THANG_IDLE_SECONDS` (default 300) so a reload resumes instantly. Then
  it is saved and the engine stops. Coming back later shows "Continue".
- **Input limits:** WebSocket frames are capped at 64 KiB, per-connection
  messages are rate limited, and only known client message types are
  relayed (`quit` never is). The engine caps lines at 64 KiB as well, and
  validates every game argument itself.
- **Origins:** set `THANG_ALLOWED_ORIGINS=https://your.site` so only your
  page can open game sockets.
- `/health` returns `{ ok, mode, sessions, engines, capacity }` for load
  balancers and monitoring.

Local mode (the default) is unchanged: one game, bound to 127.0.0.1.

## Docker

```bash
git submodule update --init           # the image builds Angband from the submodule
docker build -t thangorodrim .
docker run -p 8787:8787 -v thangorodrim-data:/data thangorodrim
```

Or `docker compose up -d --build` with the provided `docker-compose.yml`. It
sets memory and process limits and a read-only root filesystem; saves live
on the `/data` volume.

The image contains only Angband's game data and the **Gervais** tile set:
the Shockbolt tiles are excluded for licence reasons (see LICENSES.md). It
runs as the unprivileged `node` user.

## TLS and a reverse proxy

Serve the game over HTTPS so WebSockets are `wss://`. The client picks
`wss:` automatically on HTTPS pages. Example Caddyfile:

```
play.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Caddy proxies WebSocket upgrades automatically. With nginx, forward `Upgrade`
and `Connection` headers for `/ws`, and set `proxy_read_timeout` to a few
minutes.

## Sizing

Each engine process uses roughly 10–20 MB of memory and essentially no CPU
between player actions (the engine blocks waiting for input). A small VM can
hold dozens of concurrent games. The limits to watch are memory and the
container's process limit (`pids_limit`).

## Scaling beyond one machine

Sessions are tied to the process that runs their engine, so:

- Run one bridge per machine, behind a load balancer with **sticky
  routing on the session token** (`/ws?session=…`). New sessions can go
  anywhere.
- Saves must be reachable by whichever machine resumes the session: use
  one shared volume, or always route a token to the same machine.

## Security model and next steps

- Engines run the Angband C code on player-chosen inputs. Keep them
  sandboxed: unprivileged user, container limits, no network access needed
  (the engine only uses stdin/stdout and its save directory).
- **Accounts:** replace anonymous tokens with logins (OAuth or email) and map
  accounts to session directories, so saves survive clearing browser
  storage and cannot be used from a leaked token.
- **Save management:** add retention and cleanup for abandoned sessions, and
  backups of the data volume.
- **Abuse:** add per-IP connection limits at the proxy.
- **Observability:** export `/health` numbers and engine crash counts to your
  monitoring.
