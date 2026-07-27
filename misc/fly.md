# What Fly.io would actually mean

A deeper look at the option recommended in [hosting.md](hosting.md), so the
choice is made with open eyes. Nothing here has been set up yet; the config
below is what it *would* look like, not files that exist.

Written 2026-07-27.

## The mental model

Fly is not a "push your repo and we figure it out" platform. It runs **Docker
images as small VMs**, and you tell it what to run and where. That is the whole
model, and it is why it fits: this app wants one small always-on process with a
file on a disk, and that is exactly what a Fly Machine with a volume is.

Three concepts and you know enough:

- **Machine.** A VM booted from your Docker image. The smallest is
  `shared-cpu-1x` with 256 MB of RAM, which is comfortably more than a FastAPI
  process needs (this app idles well under 100 MB).
- **Volume.** A persistent NVMe disk attached to **one** machine in **one**
  region. `kit.db` lives here. This is the piece that makes SQLite viable and
  also the piece with the sharp edge, below.
- **App.** The wrapper that gets you `ubwc-kit.fly.dev`, an anycast IP, and
  automatic TLS certificates that renew themselves.

What you never touch: TLS certificates, nginx, systemd, OS patching, SSH key
management, firewall rules. That is the entire difference from the AWS route,
and it is most of the value.

## What setting it up looks like

Roughly forty minutes, once.

```sh
brew install flyctl
fly auth signup                    # needs a card, even at £2/mo

fly launch --no-deploy             # detects Python, writes fly.toml
fly volumes create ubwc_data --size 1 --region lhr
fly secrets set UBWC_COMMITTEE_PIN=… UBWC_SECRET_KEY=…
fly deploy
```

Then it is live on `https://ubwc-kit.fly.dev`, and every subsequent deploy is:

```sh
fly deploy
```

That is the day-to-day. Push code, run one command, roughly a minute, zero
downtime as it rolls the machine over.

## The two files you would add

A `Dockerfile`:

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "server.py"]
```

And `fly.toml`:

```toml
app = "ubwc-kit"
primary_region = "lhr"          # London, closest to Bristol

[env]
  UBWC_DB = "/data/kit.db"      # on the volume, not in the image
  UBWC_PORT = "8080"

[[mounts]]
  source = "ubwc_data"
  destination = "/data"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "suspend"
  auto_start_machines = true
  min_machines_running = 0
```

That is the complete infrastructure definition, in version control, readable by
whoever inherits it. Compare that with the AWS route, where the equivalent
knowledge lives in a console someone clicked through eighteen months ago.

## Three changes the app needs first

These are not optional and they are the reason this is a "half a day" job
rather than a twenty-minute one. All three are real bugs on any host with a
container filesystem, not Fly quirks.

**1. The database path is hardcoded.** `migrate.py:13` sets
`DB_PATH = ROOT / "kit.db"`, and `db.py:18` follows it. Inside a container,
`ROOT` is the image, which is thrown away on every deploy. It needs an
environment override so it can point at `/data/kit.db` on the volume.

**2. The session key regenerates on every deploy.** `server.py` writes
`.session_key` next to the code and reads it back, with the comment that this
means "a restart does not sign everyone out". True locally; false in a
container, where the file vanishes with the image. Every deploy would silently
sign out every member. It needs to become a Fly secret (`UBWC_SECRET_KEY`) or
move onto the volume.

**3. Exactly one machine, forever.** A Fly volume attaches to one machine. If
the app ever runs two, each gets its own disk and its own diverging copy of
`kit.db`, and you would not notice until two members saw different inventories.
`fly scale count 1` and leave it there. This is the single most important
operational rule and it should be a comment in `fly.toml`.

There is also a fourth thing worth knowing, which is a hazard rather than a
change. `db.ensure_db()` calls `migrate.rebuild()` whenever the database file
is missing, which silently reseeds from `data/Kit Inventory.xlsx`. On a laptop
that is a convenience. On a server, if the volume is ever lost or recreated,
the app would come back up looking healthy and populated while having discarded
every rating, fault report, session and setup the club had entered. It should
refuse to auto-seed in production and shout instead.

## What it costs

Fly **withdrew its free allowance for new accounts in 2024**, so the "basically
free" reputation is out of date and I had this wrong initially.

| Item | Cost |
|---|---|
| `shared-cpu-1x`, 256 MB, always on | ~$2.00/mo |
| 1 GB volume | ~$0.15/mo |
| Bandwidth at club traffic | negligible (~$0.02/GB) |
| **Total** | **~£2/mo** |

Sources disagree on whether there is a ~$5/mo minimum charge for new
organisations. Budget £5/mo and be pleasantly surprised. With
`auto_stop_machines` the machine suspends when idle and resumes in a second or
two on the next request, which cuts the compute part further, at the cost of
the day's first visitor waiting a moment.

The practical point: at these numbers Fly is **not meaningfully cheaper** than
Lightsail ($3.50-5) or Railway ($5). Cost should not decide this. Fit and
handover should.

## Living with it

```sh
fly logs                 # tail the running app
fly ssh console          # shell inside the machine
fly status               # what is running, where
fly ssh sftp get /data/kit.db   # pull the live database down
```

That last one is the backup story, and it matters more than the hosting choice
does. Fly snapshots volumes daily with a few days of retention, which covers
"the disk died" but not "someone deleted the app" or "we want the inventory in
three years". A nightly job pulling `kit.db` into the club Google Drive costs
nothing and makes the whole decision reversible: with that file, moving to any
other host on the list is an afternoon.

## What you are signing up for

**The good:**

- The infrastructure is two readable files in the repo, not console clicks.
- No TLS, OS patching, or reverse proxy work, ever.
- The bill is bounded by what you provision. It cannot run away like AWS can.
- One command to deploy makes the handover conversation short.

**The bad, honestly:**

- **You need Docker literacy.** Not much, but when a build breaks you are
  debugging a Dockerfile, and that is a new thing to learn. Railway hides this;
  Fly does not.
- **Volumes are the weak point.** Single region, single machine, no automatic
  replication. Fine at this scale, but it means the backup is genuinely
  load-bearing rather than a nice-to-have.
- **Fly has form for changing its pricing.** The free tier disappearing is the
  precedent. A club app should be portable enough that this is an annoyance
  rather than a crisis, which the nightly backup achieves.
- **Support is a community forum** unless you pay $29/mo, which you will not.
- **It teaches you less than AWS would.** If part of what you want from this
  project is deployment experience on your CV, Fly deliberately hides the
  things Lightsail would make you learn.

## How it compares, in one line each

- **vs Lightsail:** Fly is less work forever; Lightsail teaches you more and
  looks better on a CV. Nearly identical cost.
- **vs Railway:** Railway is easier still and needs no Dockerfile, but costs
  slightly more and gives you less control. If the Dockerfile above looks
  unappealing, take Railway.
- **vs staying on `./run.sh --share`:** free, but only up while your Mac is,
  with a URL that changes every restart. Fine for testing, impossible for
  members.

## If you want to go ahead

The order would be: fix the three code issues above (they are worth fixing
regardless of host, since they are latent bugs), add the Dockerfile and
`fly.toml`, deploy, then set up the nightly backup to Drive before telling any
member the address.
