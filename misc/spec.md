# UBWC Kit App — Product Spec

This is the current product/UX plan for the app, agreed in a design interview
(2026-07-15). It supersedes the interaction notes in [layout.txt](layout.txt),
which is kept as historical reference (it described an earlier desktop,
terminal-search-first concept). Windsurfing domain rules that any matching logic
must obey live in the repo-root [CLAUDE.md](../CLAUDE.md); this doc does not
repeat them.

## What the app is for

Three jobs, for two audiences:

1. **Committee**: manage inventory without spreadsheets. One-button add kit,
   report faults, mark fixes, track where kit is stored, and move kit for trips.
2. **Members**: a self-serve rigging assistant so a member can work out what kit
   to grab (and put back) without asking for help, and see what is available at
   the site they are at.
3. **Members**: a session logbook so a member can save a windsurf (kit + wind +
   comment + rating) to their own account and later repeat or look back on it.

An earlier idea, a combinatorial "which rigs can run at once" solver ("kit
sex"), was **dropped**: the club rarely runs short of kit and competition sites
supply their own vans, so the useful part is just recording where our kit is.
A dedicated **Trips tab was also dropped**: a trip is just a location that kit
gets moved to (see Locations and trips).

## Access and roles

*Revised 2 Aug 2026: the name-pick login and the shared committee PIN are gone,
replaced by accounts. Everything below is what the app now does.*

- **Browsing is open.** No login is needed to view the catalogue.
- **Actions need an account.** Sign-up is open (anyone with the link can create
  one) and takes a **username and a password**. The account is the identity, so
  what somebody rated, rigged and logged is genuinely theirs.
- **A sign-in lasts a term** and can be ended from the server, which is what a
  lost phone needs. Changing a password signs the other devices out.
- **Two roles: member and committee.** Ordinary members can add kit, report
  faults, use the rigging assistant, and keep a logbook. **Committee-only
  actions** (delete kit, move kit / bulk-move, edit the roster and site list,
  clear/close faults, strike out spammed ratings) are gated on the **account's
  own committee flag**. Committee is handed out by an existing committee member,
  or from the machine running the server with `manage.py`, which is also how the
  first one is made and how a forgotten password is reset.

## Platform and global layout

- **Mobile-first, web-hosted.** Primary use is members on their phones at the
  boathouse or beach. Must also be usable on a laptop for committee admin.
- **Bottom tab bar** is the primary navigation. Tabs: **Catalogue · Rig · Log ·
  + Add**.
- **Home opens straight into the catalogue.**
- A **site selector** sits at the top: the member picks which site they are at.
  It drives the catalogue's location filter and the rigging assistant's
  suggestions.
- **No emoji anywhere in the app UI.** Drawn icons (SVG) are fine and preferred;
  emoji characters are not, including the 👍/👎 of the kit rating, which must
  render as icons. This applies to app copy, labels and buttons.
- The **autocomplete search bar** (the "Bloomberg terminal" idea from
  layout.txt) is kept as a fast way to jump to a component type or item. It is
  genuinely useful on desktop and still works on mobile, but it is not the
  mobile backbone; the tab bar is.

## Tab: Catalogue

Browse the kit like a windsurf shop.

- **Browse by type**: boards, sails, masts, booms, fins, foils, misc (matching
  the schema). Grid ⇄ list toggle (photo-card grid vs compact rows).
- **Search** via the autocomplete bar (component types and item names).
- **Filter by location** (site). Active trips appear here as locations (see
  below), so "what's at Cheddar" and "what's on the Nottingham trip" are just
  filter values.
- **Item view**: image, spec table, current location (site + spot), its **kit
  rating** (star score derived from 👍/👎, see Ratings) with a **👍/👎 control to
  rate it directly**, **known faults** with a **report-a-fault** button, a
  **report-a-fix** action, and a lookup of that item's **fault + fix history**,
  plus members' comments. A **"Rig this kit" button** launches the Rig tab
  with this item preselected (see below).
  - **Top-right is an Edit button.** (A share button was mocked up here and
    **dropped** — no clear use for this app.) Edit opens the **same form as
    + Add**, prefilled with this item, so any spec can be changed. Same login
    as Add; deleting stays a committee action.
- **Item images** are uploaded, one per item, in a clean "online shop panel"
  style (product shot on a soft grey background). Committee photographs the kit,
  runs the photos through an **external** AI tool to get that look, then
  uploads. No in-app image generation.
- **Committee move tools** (committee accounts only):
  - Per-item **change-location** button on the item view.
  - A **multi-select mode**: select many items, then **Move all** to a chosen
    location in one go. Returning a trip is just "select all items at
    Nottingham, move to Cheddar".

## Tab: Rig (rigging assistant)

Self-serve "what do I grab, and where do I put it back".

- **Inputs**: approximate **sail size (m²)** and **board size (litres)**, both
  fuzzy. Your **site** comes from the top site selector (shown as "at Cheddar,
  change?"), and suggestions are **filtered to kit at that site** so it never
  points you at kit that's on a trip elsewhere.
- **The two wheels open on a size chosen for you** (added 2 Aug 2026). A member
  who has logged sessions has already answered the question better than a fixed
  default can, so the opening number is fitted from **their own logged sessions
  and the wind at their site right now**: sail area times wind is roughly
  constant for one rider, so each session gives one number, weighted by whether
  they rated that rig up and how recently it was, and shrunk toward the club
  average until they have enough sailing to speak for themselves. Board volume is
  their own usual volume, nudged for the day. Both are held inside the sizes the
  club actually owns, so a near calm suggests the biggest sail on the rack rather
  than a size nobody has. A line under the wheel says where the number came from,
  and it disappears the moment the member moves the wheel. No logbook, no wind, or
  not signed in falls back to the club's usual sizes, which is where the wizard
  started before it could learn anything.
- **Saved kit is flagged** with a bookmark wherever the assistant names a piece,
  so kit a member has already decided they like is recognisable in a list of
  sizes that otherwise all look alike. It changes no ranking and filters nothing.
- **Launched from the catalogue**: "Rig this kit" jumps here with that sail
  already selected, skipping straight to the parts step.
- **Sail-first flow** (the two systems are independent, per CLAUDE.md):
  1. Pick a **sail** near your size.
  2. App lists **all compatible masts, extensions, booms and base**, **ranked
     best-fit first** (exact-fit, then same-brand). The **member picks** each
     part; no auto-pick, because a non-app user may already have that exact
     piece in use.
  3. **Board** is chosen on a separate track from the board size given.
  - Each suggested piece shows **its spot** so a newcomer can find it.
    Out-of-action kit is excluded; usable-flagged kit shows its badge.
- **Active setup**: once built you are "**currently out on this kit**". This is
  **personal state** (so you can de-rig/log it), **not** a club-wide "this kit
  is unavailable" flag. **One active setup at a time** — starting a new rig
  prompts you to log or bin the previous one first.
- **After "complete"**, the app offers: **Edit** (you swapped something) ·
  **De-rig**.
- **De-rig and Log are separate actions, never one combined step.** Both matter,
  but they happen at different moments in real life: you are often wet and want to
  de-rig before you would touch your phone, or changed and dry and want to log
  before you forget, de-rigging later. Forcing them together creates friction, so
  the active-setup button is **De-rig only**. To log, a member goes to the **Log
  tab** and presses **Log this session** (the un-logged-session prompt surfaces
  this for them).
- **De-rig** is **guidance only**: it points you to the spot each piece goes back
  to (the item's recorded location). It changes no records, because rigging
  never moved the kit's location. (Location changes only happen via the
  committee move tools.)
- **The de-rig screen is a put-it-back checklist.** It asks whether everything is
  back where it came from, then lists **every piece taken out with the spot it
  belongs in**, so a newcomer can put kit away correctly without asking. It can be
  completed **two ways, with the same result**: tick all the boxes, or press
  confirm straight away if the kit is already away. The checklist is an aid, not a
  gate. **On confirmation the member goes straight to the logbook**, where the
  un-logged-session prompt is waiting.

## Tab: Log (session logbook)

- Shows **your past logs**, and your **current un-logged setup** with a prompt to
  log it.
- Saving a session is **always manual** (an explicit "keep this trip"; most of
  the time people won't log, so a save means they chose to).
- A session records: **kit used + wind + short comment + an overall session
  rating** (a **1-5 star** pick — one lightweight, author-only decision that just
  adds colour to the feed, not a review), plus a **quick 👍/👎 pass over each
  piece used** (feeds each item's kit rating, see Ratings), and an **optional,
  small per-item comment** — skippable, e.g. "boom kept slipping". Most people
  won't comment on every piece, so it's an unobtrusive option, not a prompt per
  item; a serious problem should instead be raised as a **fault**.
- **Kit is prefilled** from your active rig setup, with a manual "pick what I
  used" fallback.
- **Wind is auto-fetched** from a weather API by site + time, and is
  **editable**. **Which time matters:** because logging can happen well after the
  sail, the app records the **rig time** and the **de-rig time** (or the log time,
  whichever comes first) and fetches the wind for that window, not for the moment
  the member happened to fill the form in.
- **Un-logged sessions are prompted.** Recently used but un-logged kit shows a
  prompt at the top of the Log tab. This is the path a member follows after
  de-rigging and confirming: de-rig hands them to the logbook, and the prompt is
  what turns that into a logged session. The prompt persists until it is logged
  (no dismiss action).
- Sessions are a **club-visible feed**: everyone sees everyone's sessions.
- Supports **"repeat last time"**: reuse the kit from a previous session.

## Ratings (kit)

Kit is rated with a **single 👍 / 👎 per member per item** — never stars on input,
because picking a number is more thought than the rating deserves. The app
**displays** the tally as a **1-5 star** score so the catalogue reads like a shop:
**stars = 1 + 4 × (fraction of 👍)** (all 👍 → 5★, all 👎 → **1★**). The floor is
**1★, not 0★** — even disliked kit reads as one star, never a blank zero.

- **Rate as often as you sail it, but one voice each.** A member is asked again
  after every session on the same board, so every rating is **kept** (with the
  session it came from) and the **latest one is the one that counts**. A heavy
  user of one piece still cannot inflate its score, and the history behind the
  number is what lets committee **strike out** somebody who spams ratings to skew
  the club's numbers. Striking out hides the ratings from every tally and is
  reversible; nothing is deleted.
- **Always show the vote count** next to the stars, **everywhere stars appear**
  (cards included) — the count is the pinch of salt, so there is **no minimum-vote
  threshold**. The only special case is an item with **zero votes**: show
  **"Not yet rated"**.
- **Two ways to vote:**
  1. **After logging a session** — a quick 👍/👎 list of every piece you used
     (the main path; it's kit you actually sailed).
  2. **Straight from an item** (opened via the catalogue) — for kit a session
     wouldn't prompt for: a harness, wetsuit, mast base.

**Where the star score is shown** (each renders stars **+ the vote count**, or
"Not yet rated" at zero): **catalogue** grid/list cards · **item view** · **Rig
wizard** expanded pick card. The **item view additionally shows the raw 👍/👎
split** (e.g. `👍 9 · 👎 2`) under the stars, not just the derived score. **Where a
vote is entered:** the **post-log** 👍/👎 list · the **item view** 👍/👎 control.

The **overall session rating is the one exception** and stays a **1-5 star** pick:
it's author-only, one per session, and decorative in the feed, not a per-item
review that others rely on. Backed by the future logbook/session record, not the
`ratings` table (which is per-item thumbs only).

## Saved kit (favourites)

- Any member can **bookmark a piece of kit from its item page**. It is personal,
  has nothing to do with availability, and is not a club-wide flag.
- Saved kit is **flagged in the rig assistant** (above) and listed on the
  member's own profile.

## Your sailing (the profile screen)

Reached from the account menu, not from a fifth tab: the tab bar stays at four.
It deliberately **does not repeat the logbook** (the Log tab already shows a
member their own sessions and rigs under "Mine"). It shows the **shape** of their
sailing, which nothing else can:

- **sail size against wind**, one dot per logged session with the fitted curve
  through them, so the size the Rig tab opens on is something a member can see
  the reasoning for and watch move as they log more sailing;
- the **kit they keep going back to**, with how they last rated it;
- their **saved kit**.

## Tab: + Add

- Add a new item of any component type; required fields per type (as
  layout.txt). Requires an account.

## Availability and faults

- **No live "who has it out" checkout.** Rejected deliberately: with ~10 people
  rigging at once and non-app users grabbing kit unrecorded, a live status would
  be trusted and then be wrong. The app tracks **condition**, not real-time
  possession. ("Currently out on this kit" is per-user session state only.)
- **Faults** are structured, one per issue (a piece can carry several, each
  showing as its own flag around the app):
  - Every fault has a **short title** (the flag label), a **description** (the
    diagnosis and what it needs), and a **severity**.
  - **Any logged-in member reports** a fault (title + description + optional
    photo). The photo is a **diagnosis aid on the item page** (openable, not
    necessarily shown inline); the rig wizard never surfaces fault detail, it
    only acts on severity (flag or hide). Faults are inventory-management, not
    part of the rigging flow.
  - **Only committee clears/closes** a fault. **Any member can report a fix**
    (with an optional photo of the repair); a reported fix does **not** clear the
    fault on its own — it flags it as **awaiting committee sign-off**.
  - **Fault + fix history is looked up on the item page.** Every step (reported →
    fix-reported → cleared / reopened, plus any notes) is kept as an append-only
    **timeline** per fault, so the item carries a history of what has gone wrong
    and what was done about it. (Backed by `fault_events`.)
  - Two severities: **Usable** shows an **amber flag** and stays in the catalogue
    and rig suggestions; **Out of action** shows a **red flag**, is **hidden from
    rig suggestions** until cleared, and stays visible in the catalogue (flagged
    red, like a usable fault's flag but red) while being **pushed to the bottom
    of lists by default**.

## Locations and trips

- **Two-level location: site + spot.** Site is a venue/store (Cheddar lake,
  Richmond garage, the big trailer); spot is the place within it (wooden rack,
  bottom compartment).
- **Single, editable location per item** (no separate "home"). Moving kit
  overwrites its location.
- **Sites are a managed list** committee maintains; new ones can be **added
  inline** while moving kit (avoids "Notts" vs "Nottingham" drift and gives the
  catalogue filter clean values).
- **A trip is not a separate object.** Packing = committee bulk-selects kit and
  moves it to the trip location; that location then shows up as a catalogue
  filter value. **Returning** = select all items at that location and move them
  back. No named/dated trip record is stored.
- Consequence to accept: because a move overwrites location, an item's fine
  **spot** may need re-setting after a trip when kit is unpacked. That is normal
  put-away, not a special flow.

## Open items / to decide during build

- **Weather API** choice for the logbook. Open-Meteo has free historical wind and
  covers inland UK lake sites, so it is the likely fit.
- The existing `views/` scaffolding was built for the old terminal-first,
  desktop, no-roles layout.txt. Much of it will be reworked toward this
  mobile / tab-bar / roles direction.
- Exact tab labels are a build detail. (Committee PIN storage and rotation was
  one of these; it is settled, there is no PIN.)
