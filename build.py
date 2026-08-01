#!/usr/bin/env python3
"""
build.py — assembles the website's root-level HTML pages
==========================================================

WHY THIS EXISTS
---------------
Every page on the site shares the same header (logo, navigation
menu) and footer (copyright, legal links). Rather than copy-paste
that markup into every page — which means editing five files by
hand every time you want to change one word of the footer — the
shared markup lives ONCE in the partials/ folder, and this script
stitches it into each page automatically.

HOW TO USE THIS
---------------
1. To change the header/nav for the WHOLE SITE:
       edit partials/header.html
2. To change the footer for the WHOLE SITE:
       edit partials/footer.html
3. To change content specific to ONE page (its <head> title,
   its main content, its own <style>/<script>):
       edit the matching file in src/, e.g. src/index.html
4. After any of the above, regenerate the live site by running,
   from this folder:
       python build.py
   (or "python3 build.py" — same thing, depending on your system)

That's it. Step 4 rewrites index.html, terms.html, privacy.html,
bookshop_links.html and form_received.html in this folder, fully
assembled and ready to upload / open in a browser.

DO NOT hand-edit the root-level .html files directly (index.html,
terms.html, etc.) — they are generated output. Any changes made
directly to them will be silently overwritten next time this
script runs. Always edit the files in src/ or partials/ instead.

WHAT COUNTS AS "A PAGE"
------------------------
Any file placed in src/ gets built into a same-named file in the
root folder. To add a brand new page to the site, copy an existing
file in src/ as a starting point (so it already has the right
<!-- INCLUDE:header --> / <!-- INCLUDE:footer --> markers), edit
its content, then run this script again — no other setup needed.

HOW THE INCLUDES WORK
----------------------
Each file in src/ contains two special HTML comments marking where
the shared header and footer belong:

    <!-- INCLUDE:header NAV_BASE="..." -->
    <!-- INCLUDE:footer -->

This script replaces those comments with the contents of
partials/header.html and partials/footer.html. The header partial
contains a {{NAV_BASE}} placeholder, filled in with whatever
NAV_BASE value the page's include comment specifies:

  - On the homepage (src/index.html), NAV_BASE="" (empty), so a
    nav link like "{{NAV_BASE}}#work" becomes the plain same-page
    anchor "#work".
  - On every other page, NAV_BASE="https://hunchtrail.com/", so
    the same link becomes "https://hunchtrail.com/#work" — a full
    link back to that section of the homepage.

This script has no dependencies beyond the Python standard library
that ships with every Python install — nothing to pip install.
"""

import re
import sys
from pathlib import Path

# ----------------------------------------------------------------
# Where things live, relative to this script.
# ----------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
SRC_DIR = ROOT / "src"
PARTIALS_DIR = ROOT / "partials"

# The comment placed at the top of every generated file, warning
# against hand-editing it directly.
GENERATED_NOTICE = (
	"<!-- ============================================================\n"
	"     AUTO-GENERATED FILE — DO NOT EDIT DIRECTLY.\n"
	"     This file is built by build.py from the templates in\n"
	"     src/ and partials/. Any changes made here will be lost\n"
	"     the next time build.py runs. To make a change:\n"
	"       - header/nav for the whole site  -> partials/header.html\n"
	"       - footer for the whole site       -> partials/footer.html\n"
	"       - this page's own content         -> src/" + "{page_name}" + "\n"
	"     Then re-run:  python build.py\n"
	"============================================================ -->\n"
)

# Matches "<!-- INCLUDE:header NAV_BASE=\"...\" -->" and captures the
# NAV_BASE value (the "..." part) so it can be substituted into the
# header partial's {{NAV_BASE}} placeholder.
HEADER_INCLUDE_RE = re.compile(
	r'<!--\s*INCLUDE:header\s+NAV_BASE="([^"]*)"\s*-->'
)

# Matches "<!-- INCLUDE:footer -->" (no attributes needed — the
# footer is identical on every page).
FOOTER_INCLUDE_RE = re.compile(r'<!--\s*INCLUDE:footer\s*-->')


# Matches a single leading HTML comment block at the very start of a
# partial file (the explanatory note at the top of header.html /
# footer.html). Used to strip that note out of the *generated* pages
# — it's genuinely useful when editing partials/header.html itself,
# but repeating the full explanation in all five shipped pages would
# just be dead weight users never asked to download five times over.
LEADING_COMMENT_RE = re.compile(r'\A\s*<!--.*?-->\s*\n', re.DOTALL)


def strip_leading_comment(partial_text, breadcrumb):
	"""
	Remove a partial's leading explanatory comment and replace it with
	a single short breadcrumb line, so the generated page still shows
	*where* this block came from without repeating the full note.
	"""
	return LEADING_COMMENT_RE.sub(breadcrumb + "\n", partial_text, count=1)


def read(path):
	"""Read a UTF-8 text file, with a clear error if it's missing."""
	if not path.exists():
		sys.exit(f"ERROR: expected file not found: {path}")
	return path.read_text(encoding="utf-8")


def build_page(src_path, header_partial, footer_partial):
	"""
	Take one file from src/, resolve its includes, and return the
	fully-assembled HTML as a string.
	"""
	content = read(src_path)

	# --- Resolve the header include ---
	header_matches = HEADER_INCLUDE_RE.findall(content)
	if len(header_matches) != 1:
		sys.exit(
			f"ERROR: {src_path.name} must contain exactly one "
			f'<!-- INCLUDE:header NAV_BASE="..." --> comment '
			f"(found {len(header_matches)})."
		)
	nav_base = header_matches[0]
	resolved_header = strip_leading_comment(
		header_partial, "<!-- shared header — edit partials/header.html, then run build.py -->"
	).replace("{{NAV_BASE}}", nav_base).rstrip("\n")
	content = HEADER_INCLUDE_RE.sub(lambda m: resolved_header, content, count=1)

	# --- Resolve the footer include ---
	if len(FOOTER_INCLUDE_RE.findall(content)) != 1:
		sys.exit(
			f"ERROR: {src_path.name} must contain exactly one "
			f"<!-- INCLUDE:footer --> comment."
		)
	resolved_footer = strip_leading_comment(
		footer_partial, "<!-- shared footer — edit partials/footer.html, then run build.py -->"
	).rstrip("\n")
	content = FOOTER_INCLUDE_RE.sub(lambda m: resolved_footer, content, count=1)

	# --- Add the "don't hand-edit this" notice, right after the
	#     <!DOCTYPE html> line so it doesn't interfere with the
	#     browser's standards-mode detection (which relies on
	#     <!DOCTYPE html> being the very first line). ---
	notice = GENERATED_NOTICE.replace("{page_name}", src_path.name)
	if content.lstrip().lower().startswith("<!doctype html>"):
		# Split off just the first line (the doctype) and insert
		# the notice right after it.
		first_newline = content.index("\n") + 1
		content = content[:first_newline] + notice + content[first_newline:]
	else:
		# No doctype found (shouldn't normally happen) — just put
		# the notice at the very top instead of skipping it.
		content = notice + content

	return content


def main():
	if not SRC_DIR.is_dir():
		sys.exit(f"ERROR: src/ folder not found at {SRC_DIR}")
	if not PARTIALS_DIR.is_dir():
		sys.exit(f"ERROR: partials/ folder not found at {PARTIALS_DIR}")

	header_partial = read(PARTIALS_DIR / "header.html")
	footer_partial = read(PARTIALS_DIR / "footer.html")

	src_pages = sorted(SRC_DIR.glob("*.html"))
	if not src_pages:
		sys.exit(f"ERROR: no .html files found in {SRC_DIR}")

	print(f"Building {len(src_pages)} page(s) from {SRC_DIR.name}/ ...\n")

	for src_path in src_pages:
		output = build_page(src_path, header_partial, footer_partial)
		output_path = ROOT / src_path.name
		output_path.write_text(output, encoding="utf-8")
		print(f"  {src_path.relative_to(ROOT)}  ->  {output_path.relative_to(ROOT)}")

	print("\nDone. The root-level .html files above are now up to date.")


if __name__ == "__main__":
	main()
