#!/usr/bin/env bash
#
# Start the kit app so a phone can open it.
#
#   ./run.sh            local network: your phone and this Mac on the same wifi
#   ./run.sh --share    public HTTPS link: works anywhere, share it with anyone
#   ./run.sh --local    loopback only, http://127.0.0.1:8000, nothing exposed
#
# Both phone modes print the URL and a QR code to point a camera at. See
# TESTING.md for what to do when one of them will not connect.
#
set -euo pipefail
cd "$(dirname "$0")"

PORT="${UBWC_PORT:-8000}"
MODE="lan"
case "${1:-}" in
  --share) MODE="share" ;;
  --local) MODE="local" ;;
  "") ;;
  *) echo "usage: ./run.sh [--share|--local]" >&2; exit 2 ;;
esac

# --------------------------------------------------------------------------- #
# Environment. Kept in .venv so a fresh clone needs nothing but python3.
# --------------------------------------------------------------------------- #
if [ ! -x .venv/bin/python ]; then
  echo "Creating .venv ..."
  python3 -m venv .venv
fi
PY=.venv/bin/python

# Re-install only when requirements.txt is newer than the last successful run,
# so the usual start is instant.
STAMP=.venv/.requirements-stamp
if [ ! -f "$STAMP" ] || [ requirements.txt -nt "$STAMP" ]; then
  echo "Installing dependencies ..."
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet -r requirements.txt
  # Pure-python, dev-only: draws the QR codes below. Never fatal if it fails.
  "$PY" -m pip install --quiet qrcode || true
  touch "$STAMP"
fi

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
qr() {
  "$PY" - "$1" <<'EOF' 2>/dev/null || true
import sys
try:
    import qrcode
except ImportError:
    sys.exit(0)
q = qrcode.QRCode(border=2)
q.add_data(sys.argv[1])
# invert=True renders light modules as blocks, which is what scans on a
# dark terminal. On a light terminal the printed URL is the fallback.
q.print_ascii(invert=True)
EOF
}

banner() {
  echo
  echo "  ------------------------------------------------------------"
  echo "  $1"
  echo "  ------------------------------------------------------------"
  echo
  qr "$1"
  echo "  Ctrl-C to stop."
  echo
}

lan_ip() {
  # The wifi interface first, then wired, then an iPhone hotspot bridge.
  for iface in en0 en1 en2 bridge100; do
    ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
    [ -n "$ip" ] && { echo "$ip"; return; }
  done
}

# UBWC_DEV stops the phone caching stale CSS and JS between edits.
export UBWC_DEV=1
export UBWC_PORT="$PORT"

# --------------------------------------------------------------------------- #
# Loopback only
# --------------------------------------------------------------------------- #
if [ "$MODE" = "local" ]; then
  export UBWC_HOST=127.0.0.1
  echo
  echo "  http://127.0.0.1:$PORT"
  echo
  exec "$PY" server.py
fi

# --------------------------------------------------------------------------- #
# Same-wifi: bind every interface and hand out this Mac's address
# --------------------------------------------------------------------------- #
if [ "$MODE" = "lan" ]; then
  IP=$(lan_ip)
  if [ -z "$IP" ]; then
    echo "No network address found. Are you connected to wifi?" >&2
    echo "You can still use:  ./run.sh --share" >&2
    exit 1
  fi
  export UBWC_HOST=0.0.0.0
  banner "http://$IP:$PORT"
  exec "$PY" server.py
fi

# --------------------------------------------------------------------------- #
# Public link: a Cloudflare quick tunnel in front of the local server
# --------------------------------------------------------------------------- #
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "--share needs cloudflared. Install it with:" >&2
  echo >&2
  echo "    brew install cloudflared" >&2
  echo >&2
  exit 1
fi

export UBWC_HOST=127.0.0.1
"$PY" server.py &
SERVER=$!
LOG=$(mktemp -t ubwc-tunnel)
cloudflared tunnel --url "http://127.0.0.1:$PORT" >"$LOG" 2>&1 &
TUNNEL=$!
trap 'kill $SERVER $TUNNEL 2>/dev/null || true; rm -f "$LOG"' EXIT INT TERM

echo "Opening a public link ..."
URL=""
for _ in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  # Fail fast if either process died rather than waiting out the timeout.
  kill -0 $SERVER 2>/dev/null || { echo "Server exited:"; cat "$LOG"; exit 1; }
  kill -0 $TUNNEL 2>/dev/null || { echo "Tunnel exited:"; cat "$LOG"; exit 1; }
  sleep 0.5
done

if [ -z "$URL" ]; then
  echo "Could not get a tunnel URL. cloudflared said:" >&2
  cat "$LOG" >&2
  exit 1
fi

banner "$URL"
echo "  This link is temporary and dies when you Ctrl-C. Anyone with it can"
echo "  reach the app, so do not post it anywhere public."
echo
wait $SERVER
