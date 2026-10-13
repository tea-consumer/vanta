# Vanta

A fast, RAM-efficient browser built straight from Mozilla's Firefox source.
No code from other forks: Vanta is the Firefox release source tarball plus
the files in this repo.

## What Vanta changes

- `prefs/vanta.js`: built-in default prefs (fewer processes, smaller caches,
  faster tab unloading, telemetry and AI features off).
- `chrome/vanta.css`: the interface. Dark by default, vertical tabs in a
  compact sidebar that expands on hover, one slim address bar row on top, and
  the page in a rounded card. Applies to the default theme only. The accent
  is mono; set `vanta.accent` in about:config to `ice`, `sage` or `ember`
  for a color.
- `branding/logo.svg`: the Vanta "Eclipse" logo, plus its variants in
  `branding/src/` (small sizes, macOS grid, private browsing, document
  icon, wordmark, .dmg window). `scripts/make-branding.py` is the icon
  builder: it renders all of them into `branding/vanta/`, every icon and
  image Firefox's branding reads on macOS and Linux. Re-run it after
  editing a source (`--check` tells you if the output is stale,
  `--preview sheet.png` draws every icon on one sheet); needs
  `pip install cairosvg pillow`.
- `.claude/skills/vanta-icons/`: the icon toolkit Claude uses. Vanta's
  icon rules, `iconkit.py` (geometry helpers that build icons as plain
  SVG) and `icon_check.py` (lints an icon, measures legibility at 16-48px,
  compares cairosvg with a real browser, and renders a review sheet).
- `tools/icon-studio.html`: Vanta Icon Studio, for designing new icons.
  Open it in a browser (no install). It builds app icons and toolbar glyphs
  from the Eclipse's shapes (tile, eclipse, ring, arc, corona...) in Vanta's
  palette, shows them at every size and as real 16/24/32px pixels, and
  exports an SVG for `branding/` that the icon builder above renders.
  Exported SVGs carry their layers, so "Import SVG" opens them for editing.
- `scripts/apply-vanta.sh`: renames Firefox's own unofficial branding to
  Vanta and swaps in our icons, appends our prefs to `browser/app/profile/firefox.js`, and builds
  `chrome/vanta.css` into the browser chrome.
- `patches/`: our own small patches (none yet).
- Build flags: PGO, cross-language LTO, `-O3`, CPU-specific tuning.

The Firefox version is pinned in `FIREFOX_VERSION`.

## Build on NixOS (x86_64)

    nix build .#vanta
    ./result/bin/vanta

Or add this flake as an input to your system flake and put
`inputs.vanta.packages.x86_64-linux.vanta` in `environment.systemPackages`.

## Build on macOS (Apple Silicon, tuned for A18 Pro)

Needs Xcode and its command line tools.

    bash scripts/build-macos.sh

The `.dmg` ends up in `work/firefox-<version>/obj-vanta/dist/`.
PGO builds Firefox twice, so expect a long first build.

## Preview the interface without building

    bash scripts/preview-ui.sh            # uses /Applications/Firefox.app or firefox on PATH

This starts your installed Firefox with a throwaway profile that uses Vanta's
prefs and stylesheet, so you can try the look in a minute instead of a build.

## Status

Untested scaffold. Nothing has been built or benchmarked yet.
