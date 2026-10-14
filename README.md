# Vanta

A fast, RAM-efficient browser built straight from Mozilla's Firefox source.
No code from other forks: Vanta is the Firefox release source tarball plus
the files in this repo.

## What Vanta changes

- `prefs/vanta.js`: built-in default prefs (fewer processes, smaller caches,
  faster tab unloading, telemetry and AI features off).
- `scripts/apply-vanta.sh`: renames Firefox's own unofficial branding to
  Vanta and appends our prefs to `browser/app/profile/firefox.js`.
- `patches/`: our own small patches (none yet).
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

    scripts/update-mac-ui.sh

has the Linux machine repack the front end from `main` and swaps it into
`/Applications/Vanta.app` (`--undo` puts the previous one back).

`scripts/build-macos.sh` still builds everything on a Mac with Xcode, if
there is ever no Linux machine. Every step, knob and file is in
[`docs/building.md`](docs/building.md).

## Status

In daily use on the Mac, built on Firefox 158.0.
