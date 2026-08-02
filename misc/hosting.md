# Where to host the kit app

Written 2026-07-27. Prices are approximate and change; treat them as a guide to
the *shape* of each bill, not a quote. Check current terms before signing up.

For testing on a phone right now you do not need any of this. See
[TESTING.md](../TESTING.md). This document is about the day the club gets a
permanent address.

## What the app actually needs

Every option below is really being judged against five things:

1. **One always-on Python process.** FastAPI/uvicorn, one worker, tiny.
2. **A writable disk that survives restarts.** `kit.db` is a SQLite file and it
   is the club's ground-truth inventory. This is the constraint that eliminates
   most of the cheap and fashionable options, so it is worth being blunt about:
   anything "serverless" either has no disk or has one that resets.
3. **HTTPS.** Not optional. iOS will not install the app to the home screen
   over plain HTTP, and the whole design assumes a fullscreen home-screen app.
4. **Outbound internet.** `wind.py` calls Open-Meteo for the logbook.
5. **Roughly no traffic.** Fifty-odd members, spiking on trip days. Every
   option here is massively oversized for that. Performance is not a
   deciding factor; nothing below will be slow.

Two things that are *not* requirements but shape the decision more than the
technical ones:

- **Handover.** You are in Year 2. Whatever this runs on will outlive your
  committee. The next person needs to be able to redeploy it without learning
  a platform, and the bill needs to leave your personal card.
- **A capped bill.** A club app run by a rotating committee should not be
  attached to an account that can run up an unbounded bill if someone
  misconfigures something or leaks a key.

## Why it needs a server at all

Worth answering properly, because the obvious cheap idea (put the database in
the club Google Drive, host the front end on something free and static) does
not work, and the reasons are the reasons this app is shaped the way it is.

### The app is two halves

- `web/` is HTML, CSS and JavaScript. Genuinely static. Could be hosted free
  on GitHub Pages or Cloudflare Pages tomorrow.
- `server.py`, `db.py`, `validation.py` and `wind.py` are Python that has to be
  **running**, on a computer that stays on, holding the database.

A static host serves files to whoever asks for them. It has no CPU sitting
there between requests and it cannot run Python. So the second half needs
somewhere to live regardless.

### But the real reason is that the data is shared and writable

Static files are **copies**. Every phone that loads the page gets its own. If
Ben marks a mast as broken on his copy, nothing about anyone else's copy
changes.

For the club to have *one* inventory, there has to be one authoritative place
that every phone talks to, and something running there to accept "mark this
broken", decide whether that is allowed, and write it down. That something is
the server. It is not overhead to optimise away; it is the thing that makes
this a club app rather than a leaflet.

The second reason is enforcement. Anything you want to be a **rule** has to run
on a computer you control. If the committee flag were checked in JavaScript on
the phone, any member could open the browser developer tools and walk straight
past it. Code on the phone is a suggestion; code on the server is a rule. (The
rig maths in `web/js/rig/engine.js` runs on the phone on purpose, because it is
a convenience calculation that makes the wizard feel instant. It is mirrored by
`validation.py` on the server for the moment it actually matters, which is
writing to the database.)

### Why the database specifically cannot live on Google Drive

Google Drive is a **file sync service**, not a **filesystem**, and SQLite needs
a filesystem.

Saving a kit rating is not "rewrite `kit.db`". It is closer to "change these
forty bytes at this position in the file, update an index page over here, write
a small journal file alongside it, then delete the journal". SQLite also relies
on the operating system's file locking so that two writers cannot interleave
and produce nonsense.

Drive offers none of that. It syncs whole files, after the fact, with latency
measured in seconds to minutes, and it has no way to lock part of a file. When
two people change the same file at once it does not merge them, because a
200 KB binary database is not mergeable text: it picks a winner or leaves you a
"conflicted copy". And if a sync lands halfway through a write, the result is
not a lost rating, it is a **corrupt database**. Network and sync filesystems
appear on SQLite's own list of ways to corrupt a database.

The everyday version: two members rate kit during the same session, and one
silently overwrites the other. Or the file breaks and the club's inventory is
gone.

### The instinct is still right, twice over

**Drive is exactly right for backups.** Once a night, the whole file, written
by one process, never read except in an emergency. That is precisely the access
pattern Drive handles well, and it is why the nightly backup is recommended
below.

**And the real version of the idea exists.** "Database that lives in cloud
storage" is a solved problem, just not by Drive: **Litestream** continuously
streams SQLite changes to object storage, **Turso** runs SQLite as a hosted
service, and **Cloudflare D1** is a SQLite-compatible database queried over the
network. Any of these does properly what Drive would do badly.

Which points at the genuinely free architecture: **Cloudflare Pages (free
static hosting) plus D1 plus Workers** would host this whole app for £0. The
catch is that Workers run JavaScript, so `server.py`, `db.py`, `validation.py`
and `wind.py` would all have to be rewritten. That is rewriting a working app
to save five pounds a month, which is a bad trade today. Worth remembering if
the app is ever substantially rewritten for some other reason.

## The one real architectural decision

**Keep SQLite, or move to a managed Postgres?**

Everything else follows from this. `db.py` is hand-written SQL with no ORM, so
a move to Postgres is a genuine rewrite of the data layer, not a config change.

Keeping SQLite is the right call for a club this size, and it is not a
compromise: one file, trivially backed up, fast enough for thousands of times
this traffic, and impossible to leave running up a bill. But it means you need
a host that gives you **one instance with a real disk**, which is exactly the
thing modern platforms have moved away from. Read the table below with that in
mind: the options that "don't fit" almost all fail on this single point.

If you ever do want Postgres, that is the moment to revisit hosting, because it
unlocks the whole serverless tier. Do not do it pre-emptively.

## AWS, since you asked

AWS can absolutely run this. The problem is that AWS has no service that is
*both* cheap and a good fit for "one small process with a file on disk". You
pick which half to give up.

| Service | Fits SQLite? | Rough cost | The catch |
|---|---|---|---|
| **Lightsail** | Yes | $3.50-5/mo flat | You are now a sysadmin, but a gently supported one. Fixed price, static IP, generous transfer included. |
| **EC2** (t4g.micro) | Yes | $0 on free tier, then ~$4-7/mo + EBS | Same sysadmin work as Lightsail with a more complicated console and a variable bill. |
| **App Runner** | **No** | ~$5-8/mo idle, + database | No persistent filesystem. `kit.db` is wiped on every deploy. Forces RDS, which roughly triples the bill. |
| **Lambda + API Gateway** | **No** | Pennies | No disk. EFS is a footgun for SQLite with concurrent writers; the alternative is rewriting `db.py` for DynamoDB or RDS. Cold starts of several seconds on the day's first hit feel broken to a member. |
| **ECS Fargate** | With EFS | ~$10-15/mo, plus ~$16/mo if you add a load balancer | Production container orchestration for a kit list. The load balancer alone costs more than every non-AWS option here. |
| **Amplify / S3 + CloudFront** | n/a | ~$1/mo | Static hosting only. There is a Python backend, so this is not applicable. |

**The two AWS routes that actually work are EC2 and Lightsail**, and they are
the same deal: you get a bare Ubuntu box and you personally set up the systemd
unit, the reverse proxy, the Let's Encrypt certificate and its renewal, the
firewall rules, the OS patching, and the backups. That is a real afternoon to
build and a small ongoing tax forever, on top of being the thing that breaks
after you graduate and nobody knows how it was wired.

Three specific things to know before choosing AWS:

- **The free tier changed in mid-2025.** It moved from the old "12 months of
  750 hours" arrangement toward a credit-based plan for new accounts, with a
  shorter window. Whatever you have read about the AWS free tier online is
  probably describing the old one. Check the current terms at signup rather
  than assuming twelve free months.
- **AWS bills are unbounded by default.** There is no hard spend cap, only
  budget *alerts* that email you after the fact. For a personal project you
  babysit that is fine. For a club account handed between students it is a
  genuine risk, and it is the strongest argument against AWS here.
- **Student credits exist** and may cover year one (the GitHub Student
  Developer Pack has carried AWS credits; AWS Educate is worth a look). Credits
  running out is a cliff, though, not a slope, so plan for what happens after.

**The honest case *for* AWS** is not technical, and it is not a bad case:
setting this up teaches you VPCs, IAM, systemd, nginx or Caddy, and TLS, and
"deployed and maintained a production service on AWS" is a real line on a CV
that Fly.io or Railway will never give you. If that is what you want from this,
say so, because it changes the answer. Just be clear that you are buying
learning with your time, not saving money or effort.

If you want AWS, **take Lightsail, not EC2.** Same box, same skills, flat
predictable bill, far less console.

## Everything else

| Platform | Fits SQLite? | Cost | Effort | Notes |
|---|---|---|---|---|
| **Fly.io** | Yes, real volumes | ~£2-4/mo (**no free tier for new accounts** since 2024) | Low. A Dockerfile, then `fly deploy` | Built for exactly this shape. London region. TLS automatic. Can scale to zero. See [fly.md](fly.md) for what it actually involves. |
| **Railway** | Yes, volumes | $5/mo Hobby, which **includes** $5 of usage, so ~$5 flat at this size | Lowest of anything here. **No Dockerfile** | Connect the GitHub repo, it detects Python and deploys. Every push redeploys. Almost nothing to understand, which is a real handover advantage. |
| **Render** | Only on paid | Free tier unusable; $7/mo + disk to be real | Low | The free tier sleeps after 15 minutes (30-50 s cold start) **and has no persistent disk**, so `kit.db` resets. Fine for a demo, not for club data. |
| **Hetzner** (or any VPS) | Yes | ~€4/mo flat | High, same as EC2 | If the goal is learning to run a server, this teaches identical lessons at a third of AWS's price with a bill that cannot surprise you. No AWS on the CV. |
| **PythonAnywhere** | Yes | Free tier exists | Medium | Awkward fit: WSGI-oriented where FastAPI is ASGI, and the free tier restricts outbound calls to a whitelist, which would likely break the Open-Meteo wind lookup. |
| **Oracle Cloud Always Free** | Yes | £0 forever | High | A genuinely free ARM VM with absurd specs. Notoriously hard to actually provision, and Oracle has reclaimed idle free instances. Free, but not something to promise the club. |
| **University / SU hosting** | Depends | £0 | One email | Worth asking before paying anyone. Some SUs and CS departments will host a society app, it survives handover, and it costs nothing. Long shot, cheap to ask. |

## Recommendation

**Railway**, with a nightly `kit.db` backup pushed to the club Google Drive.

This was Fly.io in the first draft of this document, on the assumption that a
Dockerfile was a small ask. It is not a small ask if you have not used Docker,
and once Fly's free allowance is gone the two cost within a couple of pounds of
each other, so the tie-break falls to whichever is easier to run and to hand
over. That is Railway.

Reasons, in the order they matter:

- **Nothing new to learn to deploy it.** Connect the GitHub repo; it detects
  Python, installs `requirements.txt`, and runs the app. Every `git push`
  redeploys. No Dockerfile, no container registry, no CLI.
- **That is also the handover story.** "Push to main and it goes live" is a
  sentence the next committee understands immediately. Explaining a Dockerfile
  to a first-year is a different conversation.
- **~$5/mo flat**, because the Hobby plan's fee includes $5 of usage and this
  app fits inside it. A bill that cannot spiral.
- **The backup, not the platform, is what protects the inventory.** Once the
  database lands in Drive nightly the hosting choice stops being scary and
  becomes reversible: you can move to anything on this list by copying one file.

**Pick Fly.io instead if** you want more control and do not mind Docker, or if
you want the machine to suspend when idle. It is the better-engineered platform
and the config-in-version-control story is genuinely nicer. See [fly.md](fly.md).

**Pick Lightsail instead if** you want the AWS experience for its own sake.
That is a legitimate reason and I would not argue you out of it. Budget an
afternoon for the initial setup and set a billing alarm on day one.

Whichever of the three you pick, the same three code fixes are needed first
(hardcoded database path, regenerated session key, silent reseed from the
spreadsheet). They are listed in [fly.md](fly.md) but they are container
problems, not Fly problems, and they apply equally to Railway.

Two things to do whichever way you go:

1. **Get the billing off your personal card** before the club depends on it.
   A club account, or at minimum an expense the committee has agreed to.
2. **Ask the SU whether they will host it first.** It costs one email and
   could make this entire document irrelevant.

## Not decided yet

- Domain name. `ubwc.co.uk` or similar is roughly £10/year, or the SU may let
  you have a subdomain. Not needed to launch, easy to add later. Every option
  above gives you a working HTTPS address on day one.
- Password resets by email. Members have real accounts as of 2 Aug 2026
  (username and password, hashed with PBKDF2, sessions in the database), but a
  forgotten password is reset by a committee member rather than by email, which
  is why no email provider appears in this document. Adding self-service resets
  is what would add one.
- One consequence of accounts for hosting: set `UBWC_HTTPS=1` wherever the app
  ends up, so the session cookie is marked Secure. Every option above terminates
  HTTPS for you.
