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
| **Railway** | Yes, volumes | $5/mo minimum | Lowest of anything here | Connect GitHub, it deploys. Almost nothing to understand, which is a real handover advantage. |
| **Render** | Only on paid | Free tier unusable; $7/mo + disk to be real | Low | The free tier sleeps after 15 minutes (30-50 s cold start) **and has no persistent disk**, so `kit.db` resets. Fine for a demo, not for club data. |
| **Hetzner** (or any VPS) | Yes | ~€4/mo flat | High, same as EC2 | If the goal is learning to run a server, this teaches identical lessons at a third of AWS's price with a bill that cannot surprise you. No AWS on the CV. |
| **PythonAnywhere** | Yes | Free tier exists | Medium | Awkward fit: WSGI-oriented where FastAPI is ASGI, and the free tier restricts outbound calls to a whitelist, which would likely break the Open-Meteo wind lookup. |
| **Oracle Cloud Always Free** | Yes | £0 forever | High | A genuinely free ARM VM with absurd specs. Notoriously hard to actually provision, and Oracle has reclaimed idle free instances. Free, but not something to promise the club. |
| **University / SU hosting** | Depends | £0 | One email | Worth asking before paying anyone. Some SUs and CS departments will host a society app, it survives handover, and it costs nothing. Long shot, cheap to ask. |

## Recommendation

**Fly.io**, with a nightly `kit.db` backup pushed to the club Google Drive.

Reasons, in the order they matter:

- It is the only platform in this list *designed* for a small always-on process
  with a persistent volume, which is precisely what this app is. Nothing has to
  be worked around.
- Around £2-4/mo, on a bill that cannot spiral. Note this is **not** the
  "basically free" option it was before 2024: Fly withdrew its free allowance
  for new accounts, so the cost gap to Lightsail and Railway is now small
  enough that it should not be the deciding factor. Pick on fit and handover,
  not on price.
- Deployment is `fly deploy` from a clean repo. The next committee can be
  taught it in one sitting, which is the thing that actually determines whether
  this app is still running in three years.
- The backup, not the platform, is what protects the inventory. Once the
  database lands in Drive nightly, the hosting choice stops being scary and
  becomes reversible: you can move to anything on this list by copying one file.

**Pick Lightsail instead if** you want the AWS experience for its own sake.
That is a legitimate reason and I would not argue you out of it. Budget an
afternoon for the initial setup and set a billing alarm on day one.

**Pick Railway instead if** you want the absolute minimum thinking and $5/mo is
irrelevant to you.

Two things to do whichever way you go:

1. **Get the billing off your personal card** before the club depends on it.
   A club account, or at minimum an expense the committee has agreed to.
2. **Ask the SU whether they will host it first.** It costs one email and
   could make this entire document irrelevant.

## Not decided yet

- Domain name. `ubwc.co.uk` or similar is roughly £10/year, or the SU may let
  you have a subdomain. Not needed to launch, easy to add later. Every option
  above gives you a working HTTPS address on day one.
- Whether members ever get accounts. Today identity is a name-pick plus a
  shared committee PIN, which needs no email sending and no password storage.
  Real accounts would add an email provider to this list.
