#!/usr/bin/env bash
#
# Build the Trips drawing board.
#
#   ./build.sh          writes trips-mockup.html next to this script
#
# No app CSS is ever transcribed. tokens.css and screens.css are spliced in
# byte for byte and icons.js is turned into plain script by stripping its
# module keywords, so the mockup cannot drift from what the app ships.
# Rebuild after any change to src/, then republish (see README.md).
#
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
OUT="trips-mockup.html"

{
  cat src/head.html

  # --- the app, verbatim ----------------------------------------------------
  cat "$REPO/web/css/tokens.css"
  cat "$REPO/web/css/screens.css"

  # The trip screens borrow the catalogue's chip rail and filter panel, which
  # are scoped to [data-screen="catalogue"]. Re-emit that scope under the trip
  # screen rather than hand-copying 46 rules. Rules for other screens duplicate
  # themselves identically, which is a no-op.
  echo '/* ---- scope alias: the catalogue rail and panel, under the trip screen ---- */'
  sed 's/\[data-screen="catalogue"\]/[data-screen="trip"]/g' "$REPO/web/css/screens.css"

  # --- the proposal ---------------------------------------------------------
  cat src/design.css
  cat src/new-tile.css
  cat src/canvas.css

  # --- the page -------------------------------------------------------------
  cat src/body-top.html

  # icons.js as plain script: drop the one import, drop the export keywords.
  echo '/* ---- web/js/icons.js, module keywords stripped ---- */'
  sed -e "/^import .* from '.\/dom.js';$/d" -e 's/^export //' "$REPO/web/js/icons.js"

  cat src/body-app.js
} > "$OUT"

echo "wrote $OUT  ($(wc -c < "$OUT" | tr -d ' ') bytes)"
