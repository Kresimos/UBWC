#!/usr/bin/env bash
# Screenshot a window of frames on their own, for eyeballing during design.
#   ./inspect.sh 1 3 out.png   -> frames 1..3
set -euo pipefail
cd "$(dirname "$0")"
FROM=${1:-1}; TO=${2:-3}; OUT=${3:-inspect.png}; DARK=${4:-light}
{
  cat trips-mockup.html
  echo "<style>"
  echo ".masthead,.flow,.sectbar,.spec,.cols,.tuner,.canvas>.sectbar{display:none!important}"
  echo ".canvas{padding-top:14px}"
  echo ".slot{display:none}"
  for i in $(seq "$FROM" "$TO"); do echo ".slot:nth-child($i){display:block}"; done
  echo "</style>"
} > .inspect.html
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FLAG=""
if [ "$DARK" = "dark" ]; then FLAG="--force-dark-mode"; fi
"$CHROME" --headless --disable-gpu --hide-scrollbars $FLAG \
  --window-size=1420,1180 --screenshot="$OUT" --virtual-time-budget=4000 \
  "file://$PWD/.inspect.html" 2>/dev/null
echo "wrote $OUT"
