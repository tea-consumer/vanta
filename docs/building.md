# Building and updating Vanta

`main` is what ships. Every build, and every interface update on the Mac,
is made from `main`; feature work happens on branches and lands through
pull requests.

## Machines

- **Linux build machine** (Orpheus, x86_64 NixOS): compiles everything.
  Repo at `/media/disk/Vanta browser/vanta`, work dir `/media/disk/vanta-work2`
  (`VANTA_WORK`; it must not contain spaces, mach refuses them).
- **Mac** (A18 Pro, 8 GB): runs the PGO training pass and the installed
  `/Applications/Vanta.app`. It never compiles, to spare its SSD from swap.

## Scripts

| Script | Runs on | Does |
| --- | --- | --- |
| `scripts/fetch-firefox.sh <work>` | any | downloads the release source in `FIREFOX_VERSION`, checks Mozilla's SHA512SUMS |
| `scripts/apply-vanta.sh <src>` | any | applies branding, prefs, interface, patches, Blackout, cookie banners, modules; once per tree (`.vanta-applied` records the commit) |
| `scripts/build-macos-cross.sh instrumented` | Linux | instrumented macOS build -> `$VANTA_WORK/out/vanta-instrumented.dmg` |
| `scripts/run-profile-macos.sh <dmg>` | Mac | PGO training run on Mozilla's pages (incl. Speedometer 3) -> `work/vanta-profile.tar` |
| `scripts/build-macos-cross.sh final <tar>` | Linux | PGO + cross-language LTO build -> `obj-vanta/dist/vanta-*.dmg` |
| `scripts/repack-ui.sh [refs]` | Linux | rebuilds only the front end (chrome CSS, prefs) into the last final build; refuses when anything compiled changed |
| `scripts/update-mac-ui.sh [refs] \| --undo` | Mac | runs `repack-ui.sh` over ssh, swaps the two `omni.ja` files into the app, re-signs ad hoc, clears the startup cache |
| `scripts/build-macos.sh` | Mac | the whole build natively, fallback only |
| `nix build .#vanta` | NixOS | Linux build of Vanta through nixpkgs' Firefox |

Mozconfigs: `mozconfigs/macos-a18` (flags and PGO stages, see
`docs/performance.md`) and `mozconfigs/macos-a18-cross` (the same plus
mach's bootstrapped cross toolchain).

Knobs: `VANTA_LINKER=ld64` (Mozilla's linker for macOS release builds; the
cross build needs cctools in `~/.mozbuild/cctools`), `VANTA_JOBS`,
`VANTA_RUST` (default 1.95.0, matching Mozilla's macOS builds so LLVM
versions line up for cross-language LTO), `VANTA_PGO=0` for
`build-macos.sh`. `update-mac-ui.sh` reads `VANTA_BUILD_HOST`,
`VANTA_BUILD_REPO` and `VANTA_WORK`.

## A full release build

On Linux, from an up-to-date `main` and a fresh work dir (apply-vanta.sh
only applies once per tree):

    git checkout main && git pull
    rm -rf "$VANTA_WORK/firefox-$(cat FIREFOX_VERSION)"
    scripts/build-macos-cross.sh instrumented

Copy `vanta-instrumented.dmg` to the Mac and, from the repo there:

    scripts/run-profile-macos.sh ~/Downloads/vanta-instrumented.dmg

Copy `work/vanta-profile.tar` back and finish on Linux:

    scripts/build-macos-cross.sh final vanta-profile.tar

## Interface and prefs only

No build. Merge the change to `main`, then on the Mac (Vanta closed):

    scripts/update-mac-ui.sh origin/main

To try a pull request before merging it: `scripts/update-mac-ui.sh origin/pr/<n>`.
If the change touches anything compiled, `repack-ui.sh` stops and lists the
files: those need the full build above.

## Bumping Firefox

1. Set `FIREFOX_VERSION` and the `sha512` in `flake.nix` (Mozilla's
   `SHA512SUMS` for `source/firefox-<version>.source.tar.xz`).
2. Run `scripts/apply-vanta.sh` on the new tree. Every patch must apply;
   Blackout needs `blackout/patches/firefox-<major>.patch` for a new major.
3. Full build, then Speedometer 3.1 in a private window against the last
   result.

## Experimental patches

`patches/experimental/` is not applied. Copy a patch into `patches/` on a
branch to build with it.
