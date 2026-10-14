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
  is mono; pick Ice, Sage or Ember under Settings > Appearance > Vanta theme
  (patches/vanta-themes-settings.patch; it sets the `vanta.accent` pref).
- `branding/logo.svg`: the Vanta "Eclipse" logo, plus its variants in
  `branding/src/` (small sizes, macOS grid, private browsing, document
  icon, wordmark, .dmg window). `scripts/make-branding.py` is the icon
  builder: it renders all of them into `branding/vanta/`, every icon and
  image Firefox's branding reads on macOS and Linux. Re-run it after
  editing a source (`--check` tells you if the output is stale,
  `--preview sheet.png` draws every icon on one sheet); needs
  `pip install cairosvg pillow`.
- `.claude/skills/vanta-icons/`: the icon toolkit Claude uses. Vanta's
  icon rules, `iconkit.py` (geometry helpers), `explore.py` (sweeps and
  ranks variants), `icon_check.py` (checks an icon and renders a review
  sheet) and `audit.py` (checks everything that ships; CI runs it).
- `tools/icon-studio.html`: Vanta Icon Studio, for designing new icons.
  Open it in a browser (no install). It builds app icons and toolbar glyphs
  from the Eclipse's shapes (tile, eclipse, ring, arc, corona...) in Vanta's
  palette, shows them at every size and as real 16/24/32px pixels, and
  exports an SVG for `branding/` that the icon builder above renders.
  Exported SVGs carry their layers, so "Import SVG" opens them for editing.
- `scripts/apply-vanta.sh`: renames Firefox's own unofficial branding to
  Vanta and swaps in our icons, appends our prefs to `browser/app/profile/firefox.js`, and builds
  `chrome/vanta.css` into the browser chrome.
- `chrome/split-view.css`: split view (two tabs side by side), which is
  Firefox's own feature restyled. Each pane is its own card and the focused
  pane's rim is lit. Ctrl+Alt+S (Cmd+Option+S on macOS) splits the current
  tab and asks which tab goes beside it; Ctrl+Alt+Shift+S separates them.
  Selecting two tabs and right-clicking also offers "Add Split View".
- `patches/`: our own small patches: default split view shortcuts, and the
  split view tab picker on Vanta's flat background instead of a purple
  gradient.
- `patches/frame-readback.patch`: smooth trackpad scrolling on Apple Silicon
  Macs (see `docs/performance.md`, lever 12).
- `patches/cookiebanners-*`: bring back Firefox's cookie banner handling,
  set to reject automatically (see `docs/cookie-banners.md`).
- Blackout, a built-in ad and tracker blocker on Firefox's own content
  classifier (`docs/blackout.md`, `scripts/apply-blackout.sh`).
- `gecko/`: Vanta's own browser modules, copied into the Firefox tree by
  `apply-vanta.sh`. `VantaIntegrations.sys.mjs` creates the native messaging
  folder so desktop apps like Bitwarden can reach their extension (Touch ID
  unlock) on a Mac without Firefox installed.
- Build flags: cross-language PGO and LTO, CPU-specific tuning, PHC off.
  Every lever and why is in [`docs/performance.md`](docs/performance.md).

The Firefox version is pinned in `FIREFOX_VERSION`.

## Build on NixOS (x86_64)

    nix build .#vanta
    ./result/bin/vanta

Or add this flake as an input to your system flake and put
`inputs.vanta.packages.x86_64-linux.vanta` in `environment.systemPackages`.

## Build for the Mac

The usual way is a cross build on the Linux machine (Orpheus), with only the
PGO training run on the Mac, so the Mac never compiles anything:

    scripts/build-macos-cross.sh instrumented     # Linux
    scripts/run-profile-macos.sh vanta-instrumented.dmg   # Mac, about 10-20 min
    scripts/build-macos-cross.sh final vanta-profile.tar  # Linux

Interface and prefs changes don't need a build at all: on the Mac,

    scripts/update-mac-ui.sh origin/main

has the Linux machine repack the front end from `main` and swaps it into
`/Applications/Vanta.app` (`--undo` puts the previous one back).

`scripts/build-macos.sh` still builds everything on a Mac with Xcode, if
there is ever no Linux machine. Every step, knob and file is in
[`docs/building.md`](docs/building.md).

## Preview the interface without building

    bash scripts/preview-ui.sh            # uses /Applications/Firefox.app or firefox on PATH

This starts your installed Firefox with a throwaway profile that uses Vanta's
prefs and stylesheet, so you can try the look in a minute instead of a build.

## Status

In daily use on the Mac, built on Firefox 158.0.
