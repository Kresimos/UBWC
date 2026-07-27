# Testing the app on a phone

The app is a handset UI, so the only test that counts is a real phone. There
are two ways in, and one command for each.

```sh
./run.sh            # same wifi as this Mac
./run.sh --share    # a public HTTPS link, works from anywhere
```

Both print the URL and a QR code. Point the phone camera at the QR, tap the
banner, and you are in. `Ctrl-C` stops the server.

First run takes a minute while it builds `.venv` and installs the
dependencies. After that it starts instantly.

## Which one to use

| | `./run.sh` | `./run.sh --share` |
|---|---|---|
| Phone must be on your wifi | yes | no |
| Works on eduroam | **no** | yes |
| Works on mobile data | no | yes |
| HTTPS (needed to install to the home screen on iOS) | no | yes |
| Someone else can test it | only in the same room | yes, send them the link |
| Extra install | none | `brew install cloudflared`, once |

**Use `--share` by default.** It is the one that always works, it gives you
HTTPS so you can test the app as an installed home-screen app, and it is the
only way Ben can see what you are looking at. Plain `./run.sh` is slightly
faster and works with no internet at all, which matters at the lake.

The `--share` link is a fresh random `something.trycloudflare.com` address
every time, alive only while the command is running. Nobody can find it by
guessing, but anyone you send it to can open it, so do not post it publicly.

## Testing with Ben

Only one of you needs to run anything.

**To look at the same thing at the same time** (reviewing a change, pairing on
a bug): whoever has the code runs `./run.sh --share` and sends the other the
link. Both of you are hitting the same server and the same database, so you
will see each other's edits appear.

**To work independently**, Ben runs his own copy:

```sh
git clone <repo>
cd UBWC
./run.sh --share
```

That is the whole setup. `kit.db` builds itself on first run from the example
seed, so he gets his own throwaway inventory to poke at and cannot damage
yours. He needs Python 3 (already on macOS) and, for `--share`, cloudflared.

The committee PIN is `1878` unless `UBWC_COMMITTEE_PIN` is set.

## Installing it to the home screen

Worth doing at least once, because the app is built to run fullscreen with no
browser chrome and it looks quite different that way. Needs an HTTPS link, so
use `--share`.

- **iOS Safari**: Share button, then *Add to Home Screen*.
- **Android Chrome**: menu, then *Add to Home screen* / *Install app*.

Note that an installed iOS app keeps its own cookie store, so you will be
asked to pick your name again the first time.

## When it will not connect

**"Safari cannot open the page" on the same wifi.** Almost always the network,
not the app. University wifi (eduroam, UoB-Guest) and most public wifi use
client isolation, which blocks phone-to-laptop connections by design. There is
no setting to fix it. Use `--share`.

**First run on the Mac pops up a firewall prompt.** macOS asks whether
`python` may accept incoming connections. Say yes. If you said no once, undo it
in System Settings, Network, Firewall, Options.

**"No network address found".** The Mac is not on wifi, or it is on a VPN that
took the interface over. Turn the VPN off, or use `--share`.

**The app loads but a change you made is not there.** `run.sh` sets
`UBWC_DEV=1`, which sends `Cache-Control: no-store`, so this should not
happen any more. If it does: pull down to refresh, and if the phone is running
the installed home-screen app, close it from the app switcher rather than just
backgrounding it.

**Port 8000 is already in use.** An old server is still running:

```sh
pkill -f server.py
```

Or pick another port: `UBWC_PORT=8001 ./run.sh`.

**The `--share` link stopped working.** The tunnel dies with the command.
Restart it; you get a new URL. If you want a link that stays alive without
your Mac being on, that is hosting, not tunnelling: see
[misc/hosting.md](misc/hosting.md).

## Testing at the lake, with no internet

Cheddar has patchy signal and the tunnel needs internet at both ends. To
demo the app on the water:

1. Turn on the iPhone's personal hotspot and join the Mac to it.
2. Run `./run.sh` on the Mac.
3. Open the printed URL on any phone joined to that hotspot.

No data is used, since the traffic never leaves the hotspot. The script looks
at `bridge100` for exactly this case.
