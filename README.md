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
- `branding/logo.svg`: the Vanta "Eclipse" logo. `scripts/make-branding.py`
  renders it into the app icons in `branding/vanta/` (re-run it after
  editing the logo; needs `pip install cairosvg pillow`).
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
- `patches/cookiebanners-*`: bring back Firefox's cookie banner handling,
  set to reject automatically (see `docs/cookie-banners.md`).
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
