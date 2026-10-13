# Vanta

A fast, RAM-efficient browser built straight from Mozilla's Firefox source.
No code from other forks: Vanta is the Firefox release source tarball plus
the files in this repo.

## What Vanta changes

- `prefs/vanta.js`: built-in default prefs (fewer processes, smaller caches,
  faster tab unloading, telemetry and AI features off).
- `scripts/apply-vanta.sh`: renames Firefox's own unofficial branding to
  Vanta and appends our prefs to `browser/app/profile/firefox.js`.
- `patches/`: our own patches. The `cookiebanners-*` pair brings back
  Firefox's cookie banner handling, set to reject automatically
  (see `docs/cookie-banners.md`).
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

## Status

Untested scaffold. Nothing has been built or benchmarked yet.
