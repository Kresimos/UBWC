"""Build a rich EXAMPLE kit.db for testing the app.

The real inventory still lives in a near-empty spreadsheet, so this script
fabricates a realistic UBWC-style inventory covering *every* component type
(including fins, foils and a pile of weird misc pieces) plus a timestamped
stream of comments, reviews, usage logs, damage notes, faults, fix history and
thumb votes. It exists to prove the schema has "a place for everything" and that
browse / search / add / comment / rig-build all work against a properly
populated database.

Deliberately sized like a real club rack rather than a token sample, because the
rig wizard is only worth testing when each step has a *list* to scroll: the kit
kept at Cheddar (the wizard's default site) is the densest part of the fleet,
with masts in both diameter classes, extensions that cover the gaps between
them, and booms whose ranges overlap, so most sails have several legal ways to
be rigged. A few pieces are deliberately un-riggable on site (a formula sail no
mast on site can reach, a kids' rig below every boom's range) so the wizard's
"never list what can't be finished" rule has something to exclude.

Diameter class (RDM/SDM) is a real column (`items.diameter`) on masts,
extensions and cambered sails, and extensions are their own component type with
their own travel columns — neither is a convention inside `notes` any more.

Run directly:  python seed_example.py
This DROPS and rebuilds kit.db from schema.sql; it does not touch the xlsx.
"""
import sqlite3
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = Path.home() / "Library" / "Application Support" / "UBWC" / "kit.db"
SCHEMA_PATH = ROOT / "schema.sql"

TODAY = date(2026, 7, 15)

CHEDDAR = "Cheddar"
RICHMOND = "Richmond Building"
STORE = "SU Store"


def _ago(days: int) -> str:
    """An ISO timestamp `days` before TODAY, for realistic comment history."""
    return (TODAY - timedelta(days=days)).isoformat() + " 14:30:00"


def _day(days: int) -> str:
    return (TODAY - timedelta(days=days)).isoformat()


# --------------------------------------------------------------------------- #
# The example inventory. Each entry is (component_type, {item columns}).
# Comments/faults/votes reference items by a temporary key so we can attach them.
#
# Rig numbers are internally consistent: a sail's luff_cm is reachable by some
# mast length_cm + an extension in its 0-50cm travel, and its req_boom_cm sits
# inside some boom's min/max. Cambered sails name their diameter class in notes
# and only rig on masts of that class.
# --------------------------------------------------------------------------- #
ITEMS = {
    # ---------------------------------------------------------------------- #
    # Boards (volume in L, from big beginner platforms down to small wave)
    # ---------------------------------------------------------------------- #
    "board_start185": ("board", dict(manufacturer="Starboard", model="Start 185",
        type="Beginner", size_l=185, box_type="US Box", condition="Fair", location=CHEDDAR,
        notes="Huge stable beginner board with a daggerboard. Retractable centre "
              "fin can stick, spray silicone on the pivot.")),
    "board_viky145": ("board", dict(manufacturer="Fanatic", model="Viky 145",
        type="Beginner", size_l=145, box_type="US Box", condition="Good", location=CHEDDAR,
        notes="Soft-deck beginner board, the one to put a first-timer on after "
              "the Start 185 feels too big.")),
    "board_techno293": ("board", dict(manufacturer="Bic", model="Techno 293",
        type="Freeride", size_l=160, box_type="Powerbox", condition="Fair", location=CHEDDAR,
        notes="The old one-design workhorse. Heavy, indestructible, still the "
              "best light-wind board in the fleet.")),
    "board_shark145": ("board", dict(manufacturer="Fanatic", model="Shark 145",
        type="Freeride", size_l=145, box_type="Powerbox", condition="Good", location=CHEDDAR)),
    "board_xcite135": ("board", dict(manufacturer="JP Australia", model="X-Cite Ride 135",
        type="Freeride", size_l=135, box_type="Powerbox", condition="Very Good", location=CHEDDAR)),
    "board_carve145": ("board", dict(manufacturer="Starboard", model="Carve 145",
        type="Freeride", size_l=145, box_type="Tuttle", condition="Good", location=CHEDDAR,
        notes="Tuttle box, so it does not take the Powerbox fins in the crate.")),
    "board_gecko120": ("board", dict(manufacturer="Fanatic", model="Gecko 120",
        type="Freeride", size_l=120, box_type="Powerbox", condition="Good", location=CHEDDAR)),
    "board_rocket115": ("board", dict(manufacturer="Tabou", model="Rocket 115",
        type="Freeride", size_l=115, box_type="Powerbox", condition="Good", location=CHEDDAR)),
    "board_freesex111": ("board", dict(manufacturer="Starboard", model="Freesex 111",
        type="Freewave", size_l=111, box_type="Powerbox", condition="Good", location=CHEDDAR)),
    "board_isonic117": ("board", dict(manufacturer="Starboard", model="iSonic 117",
        type="Slalom", size_l=117, box_type="Deep Tuttle", condition="Good", location=CHEDDAR,
        notes="Race board on loan to the club. Deep Tuttle box, takes the two "
              "slalom fins in the container, nothing else.")),
    "board_kode94": ("board", dict(manufacturer="Fanatic", model="Kode 94",
        type="Freewave", size_l=94, box_type="Powerbox", condition="Good", location=CHEDDAR)),
    "board_rocket95": ("board", dict(manufacturer="Tabou", model="Rocket 95",
        type="Freewave", size_l=95, box_type="Powerbox", condition="Good", location=RICHMOND)),
    "board_freewave86": ("board", dict(manufacturer="Fanatic", model="Freewave 86",
        type="Freewave", size_l=86, box_type="Powerbox", condition="Very Good", location=RICHMOND)),
    "board_wave84": ("board", dict(manufacturer="RRD", model="Wave Cult 84",
        type="Wave", size_l=84, box_type="Powerbox", condition="Fair", location=RICHMOND)),
    "board_goya95": ("board", dict(manufacturer="Goya", model="One 95",
        type="Wave", size_l=95, box_type="Powerbox", condition="Good", location=RICHMOND,
        notes="Thruster board, but we only own the centre fin for it.")),
    "board_foil115": ("board", dict(manufacturer="Fanatic", model="Sky Foil 115",
        type="Foil", size_l=115, box_type="Deep Tuttle", condition="Very Good", location=STORE,
        notes="Foil-ready board, Deep Tuttle box. Only lend to riders who've "
              "done the foil intro session.")),
    "board_foil125": ("board", dict(manufacturer="Slingshot", model="Wizard 125",
        type="Foil", size_l=125, box_type="Deep Tuttle", condition="Good", location=STORE)),

    # ---------------------------------------------------------------------- #
    # Sails (m^2). luff_cm / req_boom_cm / cams drive the whole rig cascade.
    # ---------------------------------------------------------------------- #
    "sail_blade37": ("sail", dict(manufacturer="Severne", model="Blade 3.7",
        type="Wave", size_m2=3.7, condition="Good", location=CHEDDAR,
        luff_cm=370, req_boom_cm=140, cams=0,
        notes="The storm sail. Rigs on the 370 with no extension.")),
    "sail_banzai42": ("sail", dict(manufacturer="Goya", model="Banzai 4.2",
        type="Wave", size_m2=4.2, condition="Good", location=CHEDDAR,
        luff_cm=386, top_extension_max_cm=15, req_boom_cm=150, cams=0)),
    "sail_blade45": ("sail", dict(manufacturer="Severne", model="Blade 4.5",
        type="Wave", size_m2=4.5, condition="Very Good", location=CHEDDAR,
        luff_cm=398, req_boom_cm=158, cams=0)),
    "sail_ezzy47": ("sail", dict(manufacturer="Ezzy", model="Elite 4.7",
        type="Wave", size_m2=4.7, condition="Good", location=CHEDDAR,
        luff_cm=404, top_extension_max_cm=25, req_boom_cm=160, cams=0,
        notes="Wide adjustable head, so it will sit happily on the 370 or the "
              "400 with the difference taken up by extension.")),
    "sail_superstar50": ("sail", dict(manufacturer="Duotone", model="Super Star 5.0",
        type="Freestyle", size_m2=5.0, condition="Good", location=CHEDDAR,
        luff_cm=415, req_boom_cm=168, cams=0)),
    "sail_blacktip52": ("sail", dict(manufacturer="Simmer", model="Blacktip 5.2",
        type="Wave", size_m2=5.2, condition="Fair", location=CHEDDAR,
        luff_cm=420, req_boom_cm=172, cams=0)),
    "sail_combat53": ("sail", dict(manufacturer="Neil Pryde", model="Combat 5.3",
        type="Wave", size_m2=5.3, condition="Good", location=CHEDDAR,
        luff_cm=428, top_extension_max_cm=20, req_boom_cm=176, cams=0)),
    "sail_fusion55": ("sail", dict(manufacturer="Neil Pryde", model="Fusion 5.5",
        type="Freeride", size_m2=5.5, condition="Very Good", location=CHEDDAR,
        luff_cm=450, req_boom_cm=188, cams=0)),
    "sail_rock57": ("sail", dict(manufacturer="Tushingham", model="Rock 5.7",
        type="Freeride", size_m2=5.7, condition="Good", location=CHEDDAR,
        luff_cm=442, req_boom_cm=186, cams=0)),
    "sail_force58": ("sail", dict(manufacturer="Naish", model="Force 5.8",
        type="Wave", size_m2=5.8, condition="Good", location=CHEDDAR,
        luff_cm=445, req_boom_cm=190, cams=0)),
    "sail_storm60": ("sail", dict(manufacturer="Tushingham", model="Storm 6.0",
        type="Freeride", size_m2=6.0, condition="Good", location=CHEDDAR,
        luff_cm=458, req_boom_cm=198, cams=0)),
    "sail_move62": ("sail", dict(manufacturer="RRD", model="Move 6.2",
        type="Freeride", size_m2=6.2, condition="Good", location=CHEDDAR,
        luff_cm=455, req_boom_cm=200, cams=0)),
    "sail_gator65": ("sail", dict(manufacturer="Severne", model="Gator 6.5",
        type="Freeride", size_m2=6.5, condition="Good", location=CHEDDAR,
        luff_cm=462, req_boom_cm=205, cams=0)),
    "sail_charge68": ("sail", dict(manufacturer="Aerotech", model="Charge 6.8",
        type="Freeride", size_m2=6.8, condition="Fair", location=CHEDDAR,
        luff_cm=470, req_boom_cm=208, cams=0)),
    "sail_cross70": ("sail", dict(manufacturer="Gaastra", model="Cross 7.0",
        type="Freeride", size_m2=7.0, condition="Good", location=CHEDDAR,
        luff_cm=476, req_boom_cm=212, cams=0)),
    "sail_etype75": ("sail", dict(manufacturer="North Sails", model="E_Type 7.5",
        type="Freeride", size_m2=7.5, condition="Good", location=CHEDDAR,
        luff_cm=490, req_boom_cm=222, cams=0)),
    "sail_techno78": ("sail", dict(manufacturer="Bic", model="Techno 7.8",
        type="Freeride", size_m2=7.8, condition="Good", location=CHEDDAR,
        luff_cm=490, req_boom_cm=223, cams=1,
        diameter="SDM",
        notes="Cambered, so brief new members before lending; cams must "
              "rotate past the boom head when rigging.")),
    "sail_ncx80": ("sail", dict(manufacturer="Severne", model="NCX 8.0",
        type="Freeride", size_m2=8.0, condition="Good", location=CHEDDAR,
        luff_cm=498, req_boom_cm=230, cams=0,
        notes="Big camless freeride sail, the easiest of the 8m+ sails to rig.")),
    "sail_vapor86": ("sail", dict(manufacturer="Gaastra", model="Vapor 8.6",
        type="Slalom", size_m2=8.6, condition="Good", location=CHEDDAR,
        luff_cm=510, req_boom_cm=240, cams=1,
        diameter="SDM",
        notes="Four cams, a proper job to rig — get a committee member to "
              "walk you through it the first time.")),
    "sail_warp90": ("sail", dict(manufacturer="Duotone", model="Warp 9.0",
        type="Slalom", size_m2=9.0, condition="Fair", location=CHEDDAR,
        luff_cm=522, req_boom_cm=250, cams=1,
        diameter="SDM",
        notes="Race sail, needs the 490 and most of an extension.")),
    "sail_rsracing107": ("sail", dict(manufacturer="Neil Pryde", model="RS:Racing 10.7",
        type="Formula", size_m2=10.7, condition="Fair", location=CHEDDAR,
        luff_cm=560, req_boom_cm=270, cams=1,
        diameter="SDM",
        notes="Formula sail needing a 520+ mast we do not own any more — in "
              "the catalogue, but nothing on site can rig it.")),
    "sail_kids25": ("sail", dict(manufacturer="Gun Sails", model="Rookie 2.5",
        type="Kids", size_m2=2.5, condition="Good", location=CHEDDAR,
        luff_cm=330, req_boom_cm=120, cams=0,
        notes="Kids' taster rig. Below the range of every mast and boom we keep "
              "at the lake, it comes with its own alloy set in the crate.")),
    "sail_banzai47": ("sail", dict(manufacturer="Goya", model="Banzai 4.7",
        type="Wave", size_m2=4.7, condition="Good", location=RICHMOND,
        luff_cm=414, top_extension_max_cm=20, req_boom_cm=170, cams=0,
        notes="Adjustable head: the mast can protrude up to 20cm out the top, so "
              "it happily takes 400 or 430 masts (fill the rest with extension).")),
    "sail_hellcat56": ("sail", dict(manufacturer="Simmer", model="Hellcat 5.6",
        type="Wave", size_m2=5.6, condition="Good", location=RICHMOND,
        luff_cm=436, req_boom_cm=184, cams=0)),
    "sail_stype85": ("sail", dict(manufacturer="North Sails", model="S_Type 8.5",
        type="Slalom", size_m2=8.5, condition="Fair", location=STORE,
        luff_cm=516, req_boom_cm=236, cams=1,
        diameter="SDM",
        notes="Three-cam slalom sail, powerful, only for confident planing "
              "sailors. Needs the 490 SDM mast.")),
    "sail_retro65": ("sail", dict(manufacturer="Simmer", model="Style Retro 6.5",
        type="Freeride", size_m2=6.5, condition="Very Good", location=STORE,
        luff_cm=464, req_boom_cm=204, cams=0)),

    # ---- Wings (no luff/boom/cams; they don't enter the rig cascade) ----
    "wing_javelin35": ("wing", dict(manufacturer="Slingshot", model="Javelin 3.5",
        type="Wing", size_m2=3.5, condition="Good", location=CHEDDAR)),
    "wing_score40": ("wing", dict(manufacturer="Ensis", model="Score 4.0",
        type="Wing", size_m2=4.0, condition="Very Good", location=CHEDDAR)),
    "wing_swing52": ("wing", dict(manufacturer="F-One", model="Swing 5.2",
        type="Wing", size_m2=5.2, condition="Good", location=CHEDDAR)),
    "wing_slick50": ("wing", dict(manufacturer="Duotone", model="Slick 5.0",
        type="Wing", size_m2=5.0, condition="Very Good", location=STORE,
        notes="Best all-round wing size for our usual Cheddar wind.")),
    "wing_surfer46": ("wing", dict(manufacturer="Naish", model="Wing-Surfer 4.6",
        type="Wing", size_m2=4.6, condition="Fair", location=STORE)),

    # ---------------------------------------------------------------------- #
    # Masts (length in cm, diameter class in its own column).
    # Cheddar deliberately holds both classes at most lengths.
    # ---------------------------------------------------------------------- #
    "mast_tush340": ("mast", dict(manufacturer="Tushingham", model="Alloy 340",
        type="Mast", length_cm=340, condition="Fair", location=CHEDDAR,
        diameter="RDM",
        notes="Alloy kids/storm mast, heavy but bombproof.")),
    "mast_naish370": ("mast", dict(manufacturer="Naish", model="Carbon 370",
        type="Mast", length_cm=370, condition="Good", location=CHEDDAR,
        diameter="RDM",
        notes="60% carbon wave mast.")),
    "mast_duo400": ("mast", dict(manufacturer="Duotone", model="Platinum 400",
        type="Mast", length_cm=400, condition="Very Good", location=CHEDDAR,
        diameter="RDM",
        notes="100% carbon, the nicest small mast we own.")),
    "mast_gaastra400": ("mast", dict(manufacturer="Gaastra", model="Cross 400",
        type="Mast", length_cm=400, condition="Good", location=CHEDDAR,
        diameter="SDM",
        notes="45% carbon.")),
    "mast_x6_430": ("mast", dict(manufacturer="Neil Pryde", model="X6 430",
        type="Mast", length_cm=430, condition="Very Good", location=CHEDDAR,
        diameter="RDM",
        notes="75% carbon.")),
    "mast_sev430": ("mast", dict(manufacturer="Severne", model="Enigma 430",
        type="Mast", length_cm=430, condition="Good", location=CHEDDAR,
        diameter="RDM",
        notes="The go-to mast for the 5.5 and 6.0 sails.")),
    "mast_bic430": ("mast", dict(manufacturer="Bic", model="Techno 430",
        type="Mast", length_cm=430, condition="Fair", location=CHEDDAR,
        diameter="SDM",
        notes="Alloy-tipped club mast, fine for the cammed 7.8 at a push.")),
    "mast_x9_460": ("mast", dict(manufacturer="Neil Pryde", model="X9 460",
        type="Mast", length_cm=460, condition="Very Good", location=CHEDDAR,
        diameter="RDM",
        notes="100% carbon, light and stiff.")),
    "mast_techno460": ("mast", dict(manufacturer="Bic", model="Techno 460",
        type="Mast", length_cm=460, condition="Good", location=CHEDDAR,
        diameter="SDM",
        notes="Pairs with the Techno 7.8.")),
    "mast_chinook460": ("mast", dict(manufacturer="Chinook", model="Slalom 460",
        type="Mast", length_cm=460, condition="Fair", location=CHEDDAR,
        diameter="SDM",
        notes="Spare slalom mast, a bit soft now.")),
    "mast_north490": ("mast", dict(manufacturer="North", model="Gold 490",
        type="Mast", length_cm=490, condition="Good", location=CHEDDAR,
        diameter="SDM",
        notes="100% carbon, the only mast that rigs the big cammed sails.")),
    "mast_red400": ("mast", dict(manufacturer="Severne", model="Red 400",
        type="Mast", length_cm=400, condition="Good", location=RICHMOND,
        diameter="RDM",
        notes="Wave mast.")),
    "mast_ezzy400": ("mast", dict(manufacturer="Ezzy", model="Hookipa 400",
        type="Mast", length_cm=400, condition="Good", location=RICHMOND,
        diameter="RDM",
        notes="Constant-curve wave mast.")),
    "mast_plat490": ("mast", dict(manufacturer="North", model="Platinum 490",
        type="Mast", length_cm=490, condition="Fair", location=STORE,
        diameter="SDM",
        notes="100% carbon, matches the S_Type 8.5 slalom sail.")),
    "mast_fiber520": ("mast", dict(manufacturer="Fiberspar", model="Formula 520",
        type="Mast", length_cm=520, condition="Fair", location=STORE,
        diameter="SDM",
        notes="Formula-length mast, on long-term loan out to a member.")),

    # ---------------------------------------------------------------------- #
    # Booms (adjustable outhaul range in cm). Overlapping ranges on purpose.
    # ---------------------------------------------------------------------- #
    "boom_x9": ("boom", dict(manufacturer="Neil Pryde", model="X9",
        type="Boom", min_size_cm=140, max_size_cm=190, condition="Very Good",
        location=CHEDDAR, notes="Carbon wave/freeride boom.")),
    "boom_blade": ("boom", dict(manufacturer="Severne", model="Blade Alloy",
        type="Boom", min_size_cm=150, max_size_cm=200, condition="Good",
        location=CHEDDAR)),
    "boom_search": ("boom", dict(manufacturer="Neil Pryde", model="Search",
        type="Boom", min_size_cm=160, max_size_cm=215, condition="Good",
        location=CHEDDAR)),
    "boom_tush": ("boom", dict(manufacturer="Tushingham", model="Alloy 170",
        type="Boom", min_size_cm=170, max_size_cm=225, condition="Fair",
        location=CHEDDAR)),
    "boom_silver": ("boom", dict(manufacturer="North", model="Silver Alloy",
        type="Boom", min_size_cm=180, max_size_cm=230, condition="Good",
        location=CHEDDAR)),
    "boom_duo": ("boom", dict(manufacturer="Duotone", model="Platinum Carbon",
        type="Boom", min_size_cm=190, max_size_cm=245, condition="Very Good",
        location=CHEDDAR, notes="Best boom in the club. Please rinse it.")),
    "boom_techno": ("boom", dict(manufacturer="Bic", model="Techno",
        type="Boom", min_size_cm=205, max_size_cm=255, condition="Good",
        location=CHEDDAR)),
    "boom_gaastra": ("boom", dict(manufacturer="Gaastra", model="Slalom Race",
        type="Boom", min_size_cm=220, max_size_cm=280, condition="Fair",
        location=CHEDDAR, notes="Long slalom boom for the 8.6 and 9.0.")),
    "boom_enigma": ("boom", dict(manufacturer="Severne", model="Enigma",
        type="Boom", min_size_cm=160, max_size_cm=227, condition="Good",
        location=RICHMOND)),
    "boom_ezzy": ("boom", dict(manufacturer="Ezzy", model="Wave Alloy",
        type="Boom", min_size_cm=145, max_size_cm=195, condition="Good",
        location=RICHMOND)),
    "boom_chinook": ("boom", dict(manufacturer="Chinook", model="Pro 1",
        type="Boom", min_size_cm=200, max_size_cm=250, condition="Fair",
        location=STORE)),

    # ---------------------------------------------------------------------- #
    # Fins (box type is the hard fit constraint, length is the soft one)
    # ---------------------------------------------------------------------- #
    "fin_k4_22": ("fin", dict(manufacturer="K4", model="Flex 22",
        type="Wave", box_type="Powerbox", fin_length_cm=22, condition="Good",
        location=CHEDDAR, notes="Soft-flex wave fin, forgiving over rocks.")),
    "fin_mfc24": ("fin", dict(manufacturer="MFC", model="Wave 24",
        type="Wave", box_type="Powerbox", fin_length_cm=24, condition="Good",
        location=CHEDDAR)),
    "fin_drake26": ("fin", dict(manufacturer="Drake", model="Natural 26",
        type="Freewave", box_type="Powerbox", fin_length_cm=26, condition="Good",
        location=CHEDDAR)),
    "fin_drake30": ("fin", dict(manufacturer="Drake", model="Natural 30",
        type="Freeride", box_type="Powerbox", fin_length_cm=30, condition="Very Good",
        location=CHEDDAR)),
    "fin_select34": ("fin", dict(manufacturer="Select", model="Freeride 34",
        type="Freeride", box_type="Powerbox", fin_length_cm=34, condition="Good",
        location=CHEDDAR)),
    "fin_tabou38": ("fin", dict(manufacturer="Tabou", model="Freeride 38",
        type="Freeride", box_type="Powerbox", fin_length_cm=38, condition="Fair",
        location=CHEDDAR)),
    "fin_select36": ("fin", dict(manufacturer="Select", model="Freeride 36",
        type="Freeride", box_type="US Box", fin_length_cm=36, condition="Good",
        location=CHEDDAR)),
    "fin_star44": ("fin", dict(manufacturer="Starboard", model="Drake Shallow 44",
        type="Freeride", box_type="US Box", fin_length_cm=44, condition="Good",
        location=CHEDDAR)),
    "fin_star48": ("fin", dict(manufacturer="Starboard", model="Drake Beginner 48",
        type="Beginner", box_type="US Box", fin_length_cm=48, condition="Fair",
        location=CHEDDAR, notes="The big soft fin for the Start 185 and Viky.")),
    "fin_true34": ("fin", dict(manufacturer="True Ames", model="Freeride 34",
        type="Freeride", box_type="Tuttle", fin_length_cm=34, condition="Good",
        location=CHEDDAR)),
    "fin_true38": ("fin", dict(manufacturer="True Ames", model="Freeride 38",
        type="Freeride", box_type="Tuttle", fin_length_cm=38, condition="Fair",
        location=CHEDDAR)),
    "fin_slalom36": ("fin", dict(manufacturer="Select", model="S11 Slalom 36",
        type="Slalom", box_type="Deep Tuttle", fin_length_cm=36, condition="Good",
        location=CHEDDAR)),
    "fin_slalom40": ("fin", dict(manufacturer="Z Fins", model="Slalom 40",
        type="Slalom", box_type="Deep Tuttle", fin_length_cm=40, condition="Very Good",
        location=CHEDDAR)),
    "fin_k4_18": ("fin", dict(manufacturer="K4", model="Stubby 18",
        type="Wave", box_type="Powerbox", fin_length_cm=18, condition="Good",
        location=RICHMOND)),
    "fin_mfc21": ("fin", dict(manufacturer="MFC", model="TF 21",
        type="Wave", box_type="Powerbox", fin_length_cm=21, condition="Very Good",
        location=RICHMOND)),
    "fin_thruster": ("fin", dict(manufacturer="Goya", model="Thruster centre 18",
        type="Wave", box_type="Powerbox", fin_length_cm=18, condition="Good",
        location=RICHMOND, notes="Centre fin only; the two side fins are lost.")),
    "fin_us28": ("fin", dict(manufacturer="Select", model="Freeride 28",
        type="Freeride", box_type="US Box", fin_length_cm=28, condition="Good",
        location=STORE)),

    # ---------------------------------------------------------------------- #
    # Foils
    # ---------------------------------------------------------------------- #
    "foil_starboard": ("foil", dict(manufacturer="Starboard", model="GT-R 900",
        type="Freeride Foil", box_type="Deep Tuttle", condition="Very Good",
        location=STORE, notes="900cm^2 front wing, 95cm mast. Deep Tuttle only.")),
    "foil_slingshot": ("foil", dict(manufacturer="Slingshot", model="Hover Glide FWind",
        type="Freeride Foil", box_type="Deep Tuttle", condition="Good",
        location=STORE, notes="Alloy fuselage, 76cm mast. Heavy but very stable.")),
    "foil_np": ("foil", dict(manufacturer="Neil Pryde", model="Glide Surf",
        type="Surf Foil", box_type="Deep Tuttle", condition="Fair",
        location=RICHMOND)),

    # ---------------------------------------------------------------------- #
    # Extensions (component type of their own). `ext_min_cm`/`ext_max_cm` are
    # the travel, `diameter` the class the mast has to share.
    # ---------------------------------------------------------------------- #
    "ext_rdm22": ("ext", dict(manufacturer="Severne", model="RDM Extension",
        ext_min_cm=0, ext_max_cm=22, condition="Good", location=CHEDDAR,
        diameter="RDM",
        notes="Short-travel extension, quickest to set for the wave sails.")),
    "ext_rdm30": ("ext", dict(manufacturer="Chinook", model="RDM Extension",
        ext_min_cm=0, ext_max_cm=30, condition="Good", location=CHEDDAR,
        diameter="RDM",
        notes="Power-joint extension. Use with RDM masts only.")),
    "ext_rdm46": ("ext", dict(manufacturer="Neil Pryde", model="RDM Extension",
        ext_min_cm=0, ext_max_cm=46, condition="Very Good", location=CHEDDAR,
        diameter="RDM",
        notes="Long travel, the one that makes the 430 reach a 476 luff.")),
    "ext_sdm30": ("ext", dict(manufacturer="Chinook", model="SDM Extension",
        ext_min_cm=0, ext_max_cm=30, condition="Good", location=CHEDDAR,
        diameter="SDM",
        notes="Standard-diameter extension for the Techno rig.")),
    "ext_sdm46": ("ext", dict(manufacturer="Streamlined", model="SDM Extension",
        ext_min_cm=0, ext_max_cm=46, condition="Good", location=CHEDDAR,
        diameter="SDM",
        notes="The extension for the 490 mast + slalom sails.")),
    "ext_sdm50": ("ext", dict(manufacturer="North", model="SDM Race Extension",
        ext_min_cm=0, ext_max_cm=50, condition="Fair", location=CHEDDAR,
        diameter="SDM",
        notes="Race extension with a pulley base, longest travel we own.")),
    "ext_rdm26": ("ext", dict(manufacturer="Ezzy", model="RDM Extension",
        ext_min_cm=0, ext_max_cm=26, condition="Good", location=RICHMOND,
        diameter="RDM",
        notes="Lives with the wave kit.")),
    "ext_sdm22": ("ext", dict(manufacturer="Bic", model="SDM Extension",
        ext_min_cm=0, ext_max_cm=22, condition="Fair", location=RICHMOND,
        diameter="SDM",
        notes="Old Techno extension, the collar is worn.")),
    "ext_sdm38": ("ext", dict(manufacturer="Gaastra", model="SDM Extension",
        ext_min_cm=0, ext_max_cm=38, condition="Good", location=STORE,
        diameter="SDM",
        notes="Spare, still boxed.")),

    # ---- Misc — bases / universal joints ----
    "misc_uj_chinook": ("misc", dict(manufacturer="Chinook", model="Power Joint",
        type="Universal joint", size_generic="Standard", condition="Very Good",
        location=CHEDDAR, notes="Spare UJ / mast base. Fits the tendon-style bases.")),
    "misc_uj_streamlined": ("misc", dict(manufacturer="Streamlined", model="Tendon Base",
        type="Universal joint", size_generic="Standard", condition="Good",
        location=CHEDDAR, notes="Rubber tendon joint, the forgiving one for beginners.")),
    "misc_uj_np": ("misc", dict(manufacturer="Neil Pryde", model="Powerbase",
        type="Universal joint", size_generic="Standard", condition="Good",
        location=CHEDDAR)),
    "misc_uj_severne": ("misc", dict(manufacturer="Severne", model="Mechanical Base",
        type="Universal joint", size_generic="Euro pin", condition="Fair",
        location=CHEDDAR, notes="Mechanical joint, stiffer feel. Check the pin before use.")),
    "misc_uj_spare": ("misc", dict(manufacturer="Chinook", model="Power Joint",
        type="Universal joint", size_generic="Standard", condition="Good",
        location=STORE)),

    # ---- Misc — harnesses ----
    "misc_harness_waist_s": ("misc", dict(manufacturer="Dakine", model="Fusion",
        type="Waist harness", size_generic="S", condition="Good", location=CHEDDAR)),
    "misc_harness_waist_m": ("misc", dict(manufacturer="Dakine", model="Fusion",
        type="Waist harness", size_generic="M", condition="Good", location=STORE)),
    "misc_harness_waist_l": ("misc", dict(manufacturer="Ion", model="Riot",
        type="Waist harness", size_generic="L", condition="Very Good", location=CHEDDAR)),
    "misc_harness_seat": ("misc", dict(manufacturer="Neil Pryde", model="Elite",
        type="Seat harness", size_generic="L", condition="Fair", location=STORE)),
    "misc_harness_lines": ("misc", dict(manufacturer="Dakine", model="Harness lines",
        type="Harness lines", size_generic="24-30in pair", condition="Good",
        location=CHEDDAR, notes="Adjustable pair, spare set for the boom rack.")),

    # ---- Misc — wetsuits and warmth ----
    "misc_wetsuit54": ("misc", dict(manufacturer="O'Neill", model="Psycho",
        type="Wetsuit", size_generic="5/4mm ML", condition="Fair", location=STORE,
        notes="Club spare winter wetsuit. Zip catches, so ease it, don't yank.")),
    "misc_wetsuit32_m": ("misc", dict(manufacturer="C-Skins", model="Element",
        type="Wetsuit", size_generic="3/2mm M", condition="Good", location=CHEDDAR)),
    "misc_wetsuit32_l": ("misc", dict(manufacturer="C-Skins", model="Element",
        type="Wetsuit", size_generic="3/2mm L", condition="Good", location=CHEDDAR)),
    "misc_wetsuit43_ms": ("misc", dict(manufacturer="Gul", model="Response",
        type="Wetsuit", size_generic="4/3mm MS", condition="Fair", location=CHEDDAR)),
    "misc_boots5": ("misc", dict(manufacturer="Gul", model="Power Boot",
        type="Boots", size_generic="UK 9", condition="Good", location=CHEDDAR)),
    "misc_boots8": ("misc", dict(manufacturer="O'Neill", model="Heat Boot",
        type="Boots", size_generic="UK 11", condition="Fair", location=CHEDDAR)),
    "misc_gloves": ("misc", dict(manufacturer="Gul", model="Power Glove",
        type="Gloves", size_generic="M", condition="Good", location=STORE)),
    "misc_hood": ("misc", dict(manufacturer="C-Skins", model="Hooded",
        type="Hood", size_generic="L", condition="Good", location=STORE)),

    # ---- Misc — safety ----
    "misc_ba_l": ("misc", dict(manufacturer="Gul", model="Impact",
        type="Buoyancy aid", size_generic="L/XL", condition="Good", location=CHEDDAR)),
    "misc_ba_m": ("misc", dict(manufacturer="Crewsaver", model="Response",
        type="Buoyancy aid", size_generic="M", condition="Very Good", location=CHEDDAR)),
    "misc_ba_s": ("misc", dict(manufacturer="Crewsaver", model="Response",
        type="Buoyancy aid", size_generic="S", condition="Good", location=CHEDDAR)),
    "misc_helmet": ("misc", dict(manufacturer="Gath", model="Gedi",
        type="Helmet", size_generic="M/L", condition="Good", location=CHEDDAR)),
    "misc_firstaid": ("misc", dict(manufacturer="St John", model="Sports kit",
        type="First aid kit", size_generic="Grab bag", condition="Good",
        location=CHEDDAR, notes="Lives in the container by the door. Check dates each term.")),
    "misc_vhf": ("misc", dict(manufacturer="Icom", model="M25",
        type="VHF radio", size_generic="Handheld", condition="Good", location=CHEDDAR,
        notes="For safety-boat comms on lake days. Charge it the night before.")),
    "misc_towrope": ("misc", dict(manufacturer="Rhino", model="Tow line",
        type="Tow rope", size_generic="15m floating", condition="Good", location=CHEDDAR)),

    # ---- Misc — rigging spares and consumables ----
    "misc_uphaul": ("misc", dict(manufacturer="Chinook", model="Uphaul",
        type="Uphaul", size_generic="Elastic", condition="Good", location=CHEDDAR)),
    "misc_downhaul_rope": ("misc", dict(manufacturer="Marlow", model="Excel Pro",
        type="Downhaul rope", size_generic="4mm x 10m", condition="Very Good",
        location=CHEDDAR, notes="Cut a fresh length rather than reusing a frayed one.")),
    "misc_pulley": ("misc", dict(manufacturer="Streamlined", model="Downhaul pulley",
        type="Rigging tool", size_generic="2:1", condition="Good", location=CHEDDAR)),
    "misc_camspacers": ("misc", dict(manufacturer="Gaastra", model="Cam spacer set",
        type="Cam spacers", size_generic="RDM to SDM", condition="Good", location=CHEDDAR,
        notes="Lets a cammed sail sit on the wrong-diameter mast. Ask before using.")),
    "misc_battens": ("misc", dict(manufacturer="Tushingham", model="Spare battens",
        type="Spare battens", size_generic="Assorted", condition="Fair", location=CHEDDAR)),
    "misc_footstraps": ("misc", dict(manufacturer="Fanatic", model="Footstrap set",
        type="Spare footstraps", size_generic="Pair", condition="Good", location=CHEDDAR,
        notes="Spare adjustable straps + screws for when someone loses one.")),
    "misc_finbolts": ("misc", dict(manufacturer="Generic", model="Fin bolt set",
        type="Fin bolts", size_generic="Assorted", condition="Good", location=CHEDDAR)),
    "misc_repair": ("misc", dict(manufacturer="Tuff Stuff", model="Repair kit",
        type="Sail/board repair", size_generic="Kit", condition="Good", location=CHEDDAR,
        notes="Sail tape, ding filler, spare battens. Living in the store box.")),
    "misc_tools": ("misc", dict(manufacturer="Generic", model="Tool roll",
        type="Tools", size_generic="Multi", condition="Fair", location=CHEDDAR,
        notes="Screwdrivers, allen keys, spanner for the roof bars.")),
    "misc_pump": ("misc", dict(manufacturer="Ensis", model="Double action",
        type="Pump", size_generic="Standard", condition="Good", location=CHEDDAR,
        notes="For the wing boards. Check the hose seal.")),

    # ---- Misc — transport, storage, kit bags ----
    "misc_roofstraps": ("misc", dict(manufacturer="Rhino", model="Rack Straps",
        type="Roof straps", size_generic="4m pair", condition="Good", location=STORE,
        notes="For strapping boards to the minibus roof on Cheddar trips.")),
    "misc_roofbars": ("misc", dict(manufacturer="Thule", model="Square bars",
        type="Roof bars", size_generic="1.2m pair", condition="Fair", location=STORE)),
    "misc_boardbag": ("misc", dict(manufacturer="Fanatic", model="Board bag",
        type="Board bag", size_generic="240cm", condition="Fair", location=STORE)),
    "misc_sailbag": ("misc", dict(manufacturer="Neil Pryde", model="Quiver bag",
        type="Sail bag", size_generic="4 sail", condition="Good", location=STORE)),
    "misc_trolley": ("misc", dict(manufacturer="Generic", model="Board trolley",
        type="Trolley", size_generic="Pneumatic", condition="Fair", location=CHEDDAR,
        notes="For getting kit from the container to the water. One tyre goes soft.")),

    # ---- Misc — odds and ends ----
    "misc_gopro": ("misc", dict(manufacturer="GoPro", model="Mast Mount",
        type="Camera mount", size_generic="RDM/SDM", condition="Very Good",
        location=RICHMOND)),
    "misc_wingleash": ("misc", dict(manufacturer="Ensis", model="Coiled Leash",
        type="Wing leash", size_generic="Waist", condition="Very Good", location=STORE)),
    "misc_kidsrig": ("misc", dict(manufacturer="Gun Sails", model="Rookie alloy set",
        type="Kids rig", size_generic="Mast + boom", condition="Good", location=CHEDDAR,
        notes="Matching alloy mast and boom for the Rookie 2.5, kept together in "
              "the crate rather than on the racks.")),
    "misc_flag": ("misc", dict(manufacturer="Generic", model="Club flag",
        type="Flag", size_generic="Large", condition="Good", location=CHEDDAR)),
    "misc_whistle": ("misc", dict(manufacturer="Generic", model="Safety whistles",
        type="Whistles", size_generic="Pack of 5", condition="Good", location=CHEDDAR)),
}


# --------------------------------------------------------------------------- #
# Members. Free-text `author` on comments still carries the display name; the
# users table exists so 👍/👎 votes can be one-per-member-per-item (see below).
# --------------------------------------------------------------------------- #
USERS = [
    ("ella", "Ella", 1),
    ("tom", "Tom", 1),
    ("priya", "Priya", 1),
    ("marcus", "Marcus", 0),
    ("sam", "Sam", 1),
    ("noor", "Noor", 0),
    ("jack", "Jack", 0),
    ("hana", "Hana", 0),
    ("olly", "Olly", 0),
    ("rae", "Rae", 0),
    ("dan", "Dan", 0),
    ("committee", "Committee", 1),
]


# (item_key, kind, body, author, days_ago, stars, used_days_ago)
COMMENTS = [
    # --- boards ---
    ("board_freewave86", "usage", "Took this out at Cheddar in about 18 knots, planing early "
        "and super forgiving in the gusts. Great intermediate board.", "Ella", 4, None, 4),
    ("board_freewave86", "damage", "Small ding on the top-left of the deck near the mast track. "
        "Not through the skin, but keep an eye on it before it soaks up water.", "Tom", 4, None, 4),
    ("board_freewave86", "review", "Favourite board in the club fleet. Does everything from "
        "cruising to small jumps.", "Ella", 2, 5, None),
    ("board_freesex111", "usage", "Light-wind session, big sail. Floats a heavier rider fine.",
        "Priya", 12, None, 13),
    ("board_start185", "note", "Used for the beginner taster on Sunday, 6 people learned to "
        "uphaul on it. Daggerboard down = very stable.", "Committee", 6, None, 7),
    ("board_start185", "damage", "Nose gelcoat scuffed from the slipway. Cosmetic only.",
        "Sam", 6, None, 7),
    ("board_viky145", "usage", "Second lesson board for two of the Wednesday beginners. Much "
        "less of a barge than the Start, they both got planing straps in.", "Noor", 8, None, 8),
    ("board_techno293", "review", "Slow, heavy, and still the only thing worth rigging in 12 "
        "knots. Long may it live.", "Marcus", 16, 4, None),
    ("board_techno293", "damage", "Mast track screw is seized. Works, but do not force it.",
        "Jack", 17, None, 18),
    ("board_shark145", "usage", "Cheddar, 14 knots on the 7.5. Cruised the whole lake, never "
        "dropped off the plane.", "Hana", 5, None, 5),
    ("board_xcite135", "review", "Easiest board here to learn to gybe on. Very predictable.",
        "Olly", 11, 5, 12),
    ("board_carve145", "note", "Reminder: Tuttle box, so grab one of the True Ames fins, not "
        "the Powerbox pile.", "Committee", 21, None, None),
    ("board_gecko120", "usage", "Perfect 6.5 board on a gusty day.", "Rae", 9, None, 9),
    ("board_rocket115", "review", "Loose and lively, rewards decent technique. Would not put a "
        "beginner on it.", "Marcus", 13, 4, 14),
    ("board_isonic117", "usage", "Genuinely fast. Needed the 8.6 and a lot of commitment.",
        "Dan", 19, None, 20),
    ("board_isonic117", "note", "On loan from a member, so treat it better than club kit and "
        "wash the box out after Cheddar.", "Committee", 30, None, None),
    ("board_kode94", "usage", "Coast trip, small waves. Jumped it off the chop happily.",
        "Marcus", 26, None, 27),
    ("board_wave84", "review", "Only worth rigging when it is properly windy, but brilliant "
        "when it is.", "Marcus", 34, 4, 35),
    ("board_foil115", "review", "First proper foil flights on this! Stable platform, easy to "
        "get up on the foil. Do the intro session first though.", "Marcus", 9, 4, 10),

    # --- sails ---
    ("sail_techno78", "note", "Cam popped off during rigging again. You have to seat the "
        "bottom cam over the mast before tensioning the downhaul.", "Tom", 20, None, None),
    ("sail_techno78", "review", "Powerful for its size but the cams make it a faff. Fine once "
        "it's up.", "Priya", 15, 3, None),
    ("sail_fusion55", "usage", "Perfect 5.5 day. No-cam, rigs in two minutes, super stable.",
        "Ella", 3, None, 3),
    ("sail_fusion55", "review", "The sail I hand to anyone who has just learned to plane.",
        "Committee", 10, 5, None),
    ("sail_storm60", "usage", "Bang on for 16 knots at the lake. Downhauled hard it depowers "
        "nicely in the gusts.", "Jack", 7, None, 7),
    ("sail_gator65", "usage", "Rigged on the 460 with a couple of cm of extension, took about "
        "three minutes.", "Hana", 6, None, 6),
    ("sail_gator65", "review", "Best all-round club sail. Nothing clever, just works.",
        "Ella", 14, 5, None),
    ("sail_etype75", "usage", "Light wind on the Shark 145. Massive but easy.", "Rae", 15, None, 15),
    ("sail_ncx80", "review", "If you want 8m without cams, this is the one. Rigs easily on the "
        "490.", "Dan", 23, 4, 24),
    ("sail_vapor86", "note", "Four cams: seat every one before you take the downhaul up, or "
        "the top cam will fight you the whole way.", "Dan", 27, None, None),
    ("sail_warp90", "damage", "Batten pocket at the second batten is starting to fray. Taped, "
        "but flag it if it spreads.", "Sam", 12, None, 13),
    ("sail_blade37", "usage", "Storm day, absolutely the right call. Held on in 35 knots.",
        "Marcus", 40, None, 41),
    ("sail_blade45", "review", "Beautiful little sail, rigs on the 370 with no extension at all.",
        "Marcus", 18, 5, 19),
    ("sail_ezzy47", "note", "The adjustable head is the point of this sail: it will sit on the "
        "370 or the 400, just take up the difference on the extension.", "Committee", 29, None, None),
    ("sail_blacktip52", "damage", "Window is crazed and one panel has a small repair. Sails "
        "fine, looks rough.", "Priya", 22, None, 23),
    ("sail_combat53", "usage", "Gusty coast session. Adjustable head meant I could use the 430 "
        "and still get it tight.", "Olly", 24, None, 25),
    ("sail_rock57", "review", "Underrated. Cheap, tough, and holds shape better than it should.",
        "Noor", 20, 4, None),
    ("sail_force58", "usage", "Wave-ish day at the coast, felt lively on the Kode.",
        "Marcus", 31, None, 32),
    ("sail_charge68", "damage", "Foot panel has a taped repair from last year. Watch it after "
        "a hard session.", "Tom", 25, None, None),
    ("sail_cross70", "usage", "12-14 knots, on the Gecko. Nice easy power.", "Hana", 10, None, 10),
    ("sail_move62", "review", "Perfectly fine mid-size sail, nothing to say against it.",
        "Jack", 17, 4, None),
    ("sail_rsracing107", "note", "Reminder that we no longer own a mast long enough for this. "
        "Either buy a 520 or pass it on.", "Committee", 45, None, None),
    ("sail_kids25", "note", "Kids' rig lives in the crate with its own alloy mast and boom, "
        "not on the racks.", "Committee", 50, None, None),
    ("sail_banzai47", "usage", "Windy wave-ish session at the coast. Held together in the "
        "gusts, depowers nicely.", "Marcus", 30, None, 31),
    ("sail_stype85", "damage", "Small tear starting at the clew, taped for now, needs a proper "
        "repair before next use.", "Sam", 8, None, 9),

    # --- wings ---
    ("wing_javelin35", "review", "Good first wing. A touch small for our usual wind, size up "
        "if you can.", "Priya", 25, 3, None),
    ("wing_score40", "usage", "Winged across and back twice. Lovely handles.", "Noor", 6, None, 6),
    ("wing_slick50", "usage", "Best all-rounder. Winged the whole length of Cheddar and back.",
        "Marcus", 5, None, 5),
    ("wing_swing52", "review", "Plenty of low-end for the lake, a bit of a handful once it "
        "picks up.", "Rae", 21, 4, None),

    # --- masts, extensions, booms ---
    ("mast_x6_430", "note", "This is the go-to RDM for the 5.5 and 6.0 sails. Keep it with "
        "the Cheddar kit.", "Committee", 40, None, None),
    ("mast_sev430", "usage", "Used it with the Storm 6.0 and the 0-30 extension, spot on.",
        "Jack", 8, None, 8),
    ("mast_duo400", "review", "Genuinely lovely mast. Light enough that you notice.",
        "Marcus", 12, 5, None),
    ("mast_bic430", "note", "It is SDM, so it will take the cammed 7.8 if the 460 is out, but "
        "it needs a lot of extension.", "Tom", 28, None, None),
    ("mast_north490", "usage", "The only mast that gets the 8.6 and 9.0 up. Handle it carefully "
        "on the concrete.", "Dan", 20, None, 21),
    ("mast_chinook460", "damage", "Bottom section feels soft and there is a hairline crack "
        "starting near the ferrule. Worth a proper look.", "Sam", 5, None, 6),
    ("mast_tush340", "note", "Alloy and heavy, but it is what the kids' rig and the 3.7 live on.",
        "Committee", 44, None, None),
    ("ext_rdm30", "usage", "Swapped this in for the 5.5 on the 430. Two-pin collar is easy "
        "to set.", "Ella", 11, None, 11),
    ("ext_rdm46", "note", "This is the long one: it is what lets the 430 reach the 7.0's "
        "luff. Do not lose it.", "Committee", 26, None, None),
    ("ext_sdm50", "damage", "Pulley base is stiff and the cleat slips under full downhaul. "
        "Usable if you tie it off.", "Dan", 18, None, 19),
    ("boom_techno", "damage", "Back-end clamp slips under load, tighten fully and check before "
        "handing out.", "Tom", 18, None, 19),
    ("boom_duo", "review", "Carbon, stiff, narrow grip. Please rinse it after Cheddar.",
        "Ella", 9, 5, 9),
    ("boom_x9", "usage", "Wave boom, went out on the 4.5. Perfect length range for the small "
        "sails.", "Marcus", 19, None, 19),
    ("boom_gaastra", "note", "The only boom long enough for the 8.6 and the 9.0.",
        "Dan", 22, None, None),
    ("boom_tush", "damage", "Front clamp gasket is perished so it creeps under load. Tighten "
        "hard and check it mid-session.", "Noor", 13, None, 14),

    # --- fins, bases, misc ---
    ("fin_k4_22", "review", "Lovely soft wave fin, bounced off a rock and survived.",
        "Marcus", 22, 5, 23),
    ("fin_drake30", "usage", "Stock fin for the Gecko, no complaints.", "Rae", 9, None, 9),
    ("fin_star48", "note", "The big soft beginner fin. Put it in the Start 185 for tasters, it "
        "makes uphauling much less wobbly.", "Committee", 35, None, None),
    ("fin_slalom40", "usage", "Fast, and needs a lot of foot pressure. Rinse the box out after.",
        "Dan", 19, None, 20),
    ("fin_tabou38", "damage", "Trailing edge is chipped along about 3cm from a shallow launch. "
        "Sails fine.", "Jack", 15, None, 16),
    ("misc_uj_chinook", "usage", "Swapped this in when the board base failed mid-session. Solid "
        "spare.", "Ella", 11, None, 11),
    ("misc_uj_severne", "damage", "Mechanical joint, and the pin is worn. I would use the "
        "tendon base instead until it is replaced.", "Tom", 7, None, 8),
    ("misc_harness_seat", "note", "Seat harness. Some people love it, some hate it. Buckle is "
        "stiff, works fine.", "Priya", 33, None, None),
    ("misc_wetsuit54", "damage", "Neck seal starting to perish. Still usable but order a "
        "replacement for winter.", "Sam", 14, None, None),
    ("misc_wetsuit32_m", "usage", "Wore this all Wednesday, dried by Thursday. Good suit.",
        "Hana", 6, None, 6),
    ("misc_camspacers", "note", "These let a cammed sail go on the wrong-diameter mast. Works, "
        "but ask a committee member first, it is easy to do badly.", "Committee", 38, None, None),
    ("misc_vhf", "note", "Charge it the night before a lake day. It holds about six hours.",
        "Committee", 24, None, None),
    ("misc_trolley", "damage", "Left tyre goes soft over a week. Pump it before you load a "
        "board on.", "Olly", 16, None, 17),
    ("misc_firstaid", "note", "Checked the dates this month, two plasters packs replaced.",
        "Sam", 4, None, None),
    ("misc_pump", "damage", "Hose seal leaks unless you hold it. Fine for one wing board, "
        "annoying for three.", "Noor", 12, None, 13),
    ("misc_kidsrig", "usage", "Two kids on it at the family day, both sailed. Alloy mast is "
        "indestructible.", "Committee", 42, None, 43),
]

# (item_key, title, description, severity, reported_by, days_ago) -> tracked defects
FAULTS = [
    ("board_freesex111", "Paint chips on rail",
        "Paint chips along the rail. Cosmetic only, fine to sail.",
        "usable", "import", 60),
    ("board_techno293", "Seized mast track screw",
        "Mast track screw is seized. The track still works, but do not force it "
        "or the insert will strip.", "usable", "Jack", 17),
    ("board_start185", "Daggerboard sticks",
        "Retractable centre fin sticks halfway. Silicone on the pivot frees it.",
        "usable", "import", 60),
    ("board_wave84", "Soft spot behind mast track",
        "Small soft patch behind the mast track. Needs a proper look before it "
        "goes out again.", "out_of_action", "Marcus", 34),
    ("sail_techno78", "Bottom cam falls off",
        "Bottom cam falls off when rigging; seat it over the mast before "
        "tensioning the downhaul.", "usable", "import", 60),
    ("sail_stype85", "Clew tear, needs repair",
        "Tear starting at the clew, taped for now, needs a proper repair before "
        "it's sailed again.", "out_of_action", "Sam", 8),
    ("sail_warp90", "Batten pocket fraying",
        "Second batten pocket is fraying at the luff end. Taped; watch whether "
        "it spreads.", "usable", "Sam", 12),
    ("sail_blacktip52", "Crazed window, panel repair",
        "Monofilm window is crazed and there is an old panel repair. Sails fine, "
        "just looks tired.", "usable", "Priya", 22),
    ("sail_charge68", "Taped foot panel",
        "Taped repair along the foot panel from last season. Check it after any "
        "hard session.", "usable", "Tom", 25),
    ("mast_chinook460", "Hairline crack near ferrule",
        "Bottom section is soft and there is a hairline crack starting near the "
        "ferrule. Off the racks until someone competent inspects it.",
        "out_of_action", "Sam", 5),
    ("boom_techno", "Rear clamp slips",
        "Rear clamp slips under load; tighten fully and check before handing it "
        "out.", "usable", "Tom", 18),
    ("boom_tush", "Front clamp creeps",
        "Perished gasket in the front clamp, so the boom creeps shorter under "
        "load. Tighten hard and re-check mid-session.", "usable", "Noor", 13),
    ("ext_sdm50", "Pulley cleat slips",
        "The cleat on the pulley base slips under full downhaul. Usable if you "
        "tie the tail off properly.", "usable", "Dan", 18),
    ("misc_uj_severne", "Worn mechanical pin",
        "The mechanical joint's pin is visibly worn. Use the tendon base until "
        "it is replaced.", "out_of_action", "Tom", 7),
    ("misc_wetsuit54", "Neck seal perishing",
        "Neck seal starting to perish. Still usable but order a replacement for "
        "winter.", "usable", "Sam", 14),
    ("misc_trolley", "Tyre goes soft",
        "Left tyre loses pressure over about a week. Pump before loading.",
        "usable", "Olly", 16),
    ("misc_pump", "Leaking hose seal",
        "Hose seal leaks unless held by hand. Fine for one board, slow for "
        "several.", "usable", "Noor", 12),
    ("fin_tabou38", "Chipped trailing edge",
        "About 3cm of the trailing edge is chipped from a shallow launch. No "
        "effect on the box fit.", "usable", "Jack", 15),
]

# (item_key, fault_title, kind, body, author, days_ago) -> the report/fix timeline
# behind a fault. The initial 'reported' event is generated for every fault; these
# are the follow-ups (a member's fix, committee sign-off, a reopening).
FAULT_EVENTS = [
    ("board_start185", "Daggerboard sticks", "fix_reported",
        "Sprayed the pivot with silicone and worked it up and down twenty times. "
        "Retracts smoothly now.", "Olly", 20),
    ("board_start185", "Daggerboard sticks", "note",
        "Still fine two sessions later, but it is a recurring one — expect to do "
        "it again each term.", "Committee", 12),
    ("boom_techno", "Rear clamp slips", "fix_reported",
        "Replaced the clamp bolt and re-taped the shim. Held for a full session "
        "on the 7.8.", "Marcus", 9),
    ("misc_wetsuit54", "Neck seal perishing", "note",
        "Replacement suit ordered, due before the winter term.", "Committee", 6),
    ("sail_stype85", "Clew tear, needs repair", "note",
        "Quoted at the sail loft: worth repairing, about two weeks.", "Committee", 4),
    ("mast_chinook460", "Hairline crack near ferrule", "note",
        "Taken off the racks and tagged. Do not put it back until it is checked.",
        "Committee", 4),
    ("fin_tabou38", "Chipped trailing edge", "fix_reported",
        "Sanded the chip smooth so it does not catch weed. Cosmetically obvious, "
        "sails the same.", "Jack", 10),
]

# (item_key, thumbs_up, thumbs_down) -> the 👍/👎 tally the catalogue turns into
# stars (1 + 4 x fraction-up). Votes are spread across members so the schema's
# one-standing-vote-per-member-per-item constraint is exercised properly.
VOTES = [
    ("board_freewave86", 6, 0),
    ("board_freesex111", 3, 1),
    ("board_gecko120", 5, 0),
    ("board_start185", 3, 2),
    ("board_viky145", 4, 0),
    ("board_techno293", 5, 2),
    ("board_shark145", 4, 1),
    ("board_xcite135", 6, 0),
    ("board_carve145", 2, 1),
    ("board_rocket115", 4, 1),
    ("board_isonic117", 3, 0),
    ("board_kode94", 4, 0),
    ("board_rocket95", 3, 1),
    ("board_wave84", 2, 2),
    ("board_foil115", 3, 1),
    ("sail_blade37", 3, 0),
    ("sail_blade45", 4, 0),
    ("sail_ezzy47", 5, 0),
    ("sail_superstar50", 2, 1),
    ("sail_blacktip52", 1, 3),
    ("sail_combat53", 4, 1),
    ("sail_fusion55", 7, 0),
    ("sail_rock57", 3, 1),
    ("sail_force58", 3, 1),
    ("sail_storm60", 5, 1),
    ("sail_move62", 3, 1),
    ("sail_gator65", 8, 0),
    ("sail_charge68", 2, 2),
    ("sail_cross70", 4, 0),
    ("sail_etype75", 4, 1),
    ("sail_techno78", 2, 3),
    ("sail_ncx80", 5, 0),
    ("sail_vapor86", 3, 1),
    ("sail_warp90", 2, 2),
    ("sail_kids25", 2, 0),
    ("wing_javelin35", 2, 2),
    ("wing_score40", 4, 0),
    ("wing_swing52", 3, 1),
    ("wing_slick50", 5, 0),
    ("mast_x6_430", 5, 0),
    ("mast_sev430", 4, 0),
    ("mast_duo400", 6, 0),
    ("mast_naish370", 3, 0),
    ("mast_tush340", 1, 2),
    ("mast_bic430", 2, 2),
    ("mast_techno460", 3, 1),
    ("mast_x9_460", 5, 0),
    ("mast_chinook460", 1, 3),
    ("mast_north490", 4, 1),
    ("boom_x9", 6, 0),
    ("boom_blade", 3, 1),
    ("boom_search", 4, 0),
    ("boom_tush", 1, 3),
    ("boom_silver", 3, 1),
    ("boom_duo", 7, 0),
    ("boom_techno", 2, 2),
    ("boom_gaastra", 3, 1),
    ("ext_rdm22", 3, 0),
    ("ext_rdm30", 5, 0),
    ("ext_rdm46", 4, 0),
    ("ext_sdm30", 3, 1),
    ("ext_sdm46", 3, 0),
    ("ext_sdm50", 1, 2),
    ("misc_uj_chinook", 4, 0),
    ("misc_uj_streamlined", 5, 0),
    ("misc_uj_np", 3, 0),
    ("misc_uj_severne", 1, 3),
    ("fin_k4_22", 5, 0),
    ("fin_drake30", 4, 0),
    ("fin_select34", 3, 0),
    ("fin_tabou38", 2, 1),
    ("fin_select36", 3, 1),
    ("fin_star48", 3, 1),
    ("fin_true34", 2, 0),
    ("fin_slalom40", 3, 0),
    ("misc_harness_waist_l", 4, 0),
    ("misc_harness_seat", 2, 3),
    ("misc_wetsuit32_m", 4, 0),
    ("misc_wetsuit54", 1, 3),
    ("misc_ba_m", 3, 0),
    ("misc_trolley", 2, 2),
    ("misc_pump", 1, 2),
    ("misc_repair", 4, 0),
]


def seed(db_path: Path = DB_PATH) -> dict:
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))

    user_ids = {}
    for username, display, is_admin in USERS:
        cur = conn.execute(
            "INSERT INTO users (username, display_name, is_admin) VALUES (?, ?, ?)",
            (username, display, is_admin),
        )
        user_ids[username] = cur.lastrowid

    ids = {}
    for key, (ctype, cols) in ITEMS.items():
        record = {"component_type": ctype, **cols}
        fields = list(record.keys())
        placeholders = ", ".join("?" for _ in fields)
        cur = conn.execute(
            f"INSERT INTO items ({', '.join(fields)}) VALUES ({placeholders})",
            [record[f] for f in fields],
        )
        ids[key] = cur.lastrowid

    for key, kind, body, author, days_ago, stars, used_days in COMMENTS:
        conn.execute(
            "INSERT INTO comments (item_id, kind, body, stars, author, used_on, "
            "created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (ids[key], kind, body, stars, author,
             _day(used_days) if used_days is not None else None, _ago(days_ago)),
        )

    fault_ids = {}
    for key, title, desc, severity, by, days_ago in FAULTS:
        cur = conn.execute(
            "INSERT INTO faults (item_id, title, description, severity, "
            "reported_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (ids[key], title, desc, severity, by, _ago(days_ago)),
        )
        fault_ids[(key, title)] = cur.lastrowid
        # Every fault opens with its own 'reported' event, so the item page's
        # timeline is complete rather than starting mid-story.
        conn.execute(
            "INSERT INTO fault_events (fault_id, kind, body, author, created_at) "
            "VALUES (?, 'reported', ?, ?, ?)",
            (cur.lastrowid, desc, by, _ago(days_ago)),
        )

    for key, title, kind, body, author, days_ago in FAULT_EVENTS:
        conn.execute(
            "INSERT INTO fault_events (fault_id, kind, body, author, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (fault_ids[(key, title)], kind, body, author, _ago(days_ago)),
        )

    # Spread each item's votes over different members (one standing vote each),
    # walking the member list so the same people aren't always the upvoters.
    usernames = [u[0] for u in USERS]
    cursor = 0
    for key, up, down in VOTES:
        for n, vote in ((up, 1), (down, -1)):
            for _ in range(n):
                username = usernames[cursor % len(usernames)]
                cursor += 1
                conn.execute(
                    "INSERT OR IGNORE INTO ratings (user_id, item_id, vote) VALUES (?, ?, ?)",
                    (user_ids[username], ids[key], vote),
                )
        cursor += 1   # shift the starting point for the next item

    conn.commit()
    summary = {
        "items": conn.execute("SELECT COUNT(*) FROM items").fetchone()[0],
        "comments": conn.execute("SELECT COUNT(*) FROM comments").fetchone()[0],
        "faults": conn.execute("SELECT COUNT(*) FROM faults").fetchone()[0],
        "fault_events": conn.execute("SELECT COUNT(*) FROM fault_events").fetchone()[0],
        "votes": conn.execute("SELECT COUNT(*) FROM ratings").fetchone()[0],
        "users": conn.execute("SELECT COUNT(*) FROM users").fetchone()[0],
        "by_type": dict(conn.execute(
            "SELECT component_type, COUNT(*) FROM items GROUP BY component_type"
        ).fetchall()),
        "by_location": dict(conn.execute(
            "SELECT location, COUNT(*) FROM items GROUP BY location ORDER BY 2 DESC"
        ).fetchall()),
    }
    conn.close()
    return summary


if __name__ == "__main__":
    result = seed()
    print(f"Seeded example {DB_PATH}")
    print(f"  items:    {result['items']}  {result['by_type']}")
    print(f"  sites:    {result['by_location']}")
    print(f"  comments: {result['comments']}")
    print(f"  faults:   {result['faults']} ({result['fault_events']} timeline events)")
    print(f"  votes:    {result['votes']} from {result['users']} members")
