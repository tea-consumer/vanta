#!/usr/bin/env bash
# Build Vanta for macOS (Apple Silicon) on a Linux x86_64 machine, with PGO
# split across two machines the way Mozilla builds release Firefox:
#
#   1. Linux:  scripts/build-macos-cross.sh instrumented
#              -> work/out/vanta-instrumented.dmg
#   2. Mac:    scripts/run-profile-macos.sh vanta-instrumented.dmg (about 20 min)
#              -> vanta-profile.tar (raw profiles + en-US.log jar order)
#   3. Linux:  scripts/build-macos-cross.sh final vanta-profile.tar
#              -> work/firefox-<version>/obj-vanta/dist/vanta-*.dmg
#
# mach's --enable-bootstrap fetches the cross toolchain (clang, cctools, the
# MacOSX SDK, dmg tools). Rust comes from rustup, pinned to the version
# Mozilla's macOS builds use so its LLVM matches clang for cross-language LTO.
#
# Env knobs:
#   VANTA_JOBS=N   parallel compile jobs (default: half the cores, to stay out of swap)
#   VANTA_RUST=X   rustup toolchain (default 1.95.0)
#
# The work dir must not contain spaces (mach refuses); set VANTA_WORK if the
# repo path does.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(cat "$here/FIREFOX_VERSION")"
work="${VANTA_WORK:-$here/work}"
src="$work/firefox-$version"
stage="${1:?usage: build-macos-cross.sh instrumented | final <vanta-profile.tar>}"
rust="${VANTA_RUST:-1.95.0}"
jobs="${VANTA_JOBS:-$(( $(nproc) / 2 ))}"

case "$(realpath "$src" 2>/dev/null || echo "$src")" in
  *" "*) echo "work dir has a space in it; set VANTA_WORK" >&2; exit 1 ;;
esac

"$here/scripts/fetch-firefox.sh" "$work" >/dev/null
"$here/scripts/apply-vanta.sh" "$src"

rustup toolchain install "$rust" --profile minimal -t aarch64-apple-darwin >/dev/null
export PATH="$HOME/.rustup/toolchains/$rust-x86_64-unknown-linux-gnu/bin:$PATH"
export VANTA_ROOT="$here"
export MOZCONFIG="$here/mozconfigs/macos-a18-cross"
export MOZ_PARALLEL_BUILD="$jobs"
export VANTA_PGO_DIR="$work/pgo"
cd "$src"

case "$stage" in
  instrumented)
    export VANTA_PGO_STAGE=generate
    ./mach --no-interactive build
    ./mach package
    instr="$src/obj-vanta-instrumented"
    mkdir -p "$work/out"
    cp "$instr"/dist/*.dmg "$work/out/vanta-instrumented.dmg"
    ls -lh "$work/out/vanta-instrumented.dmg"
    ;;
  final)
    raw="${2:?final needs the vanta-profile.tar from the Mac}"
    rm -rf "$VANTA_PGO_DIR"; mkdir -p "$VANTA_PGO_DIR/raw"
    # macOS tar adds AppleDouble ._ files for xattrs; skip them.
    tar -xf "$raw" -C "$VANTA_PGO_DIR/raw" --exclude="._*" 2>/dev/null || tar -xf "$raw" -C "$VANTA_PGO_DIR/raw"
    # Merge here, with the llvm-profdata that matches the clang doing the
    # build, rather than whatever version the Mac has.
    profdata="$HOME/.mozbuild/clang/bin/llvm-profdata"
    find "$VANTA_PGO_DIR/raw" -name '*.profraw' ! -name '._*' -print0 \
      | xargs -0 "$profdata" merge -o "$VANTA_PGO_DIR/merged.profdata"
    cp "$(find "$VANTA_PGO_DIR/raw" -name en-US.log | head -1)" "$VANTA_PGO_DIR/en-US.log"
    export VANTA_PGO_STAGE=use
    ./mach --no-interactive build
    ./mach package
    ls -1 obj-vanta/dist/*.dmg
    # scripts/repack-ui.sh reuses this build ID for front-end-only updates.
    sed -n 's/^BuildID=//p' obj-vanta/dist/vanta/Vanta.app/Contents/Resources/application.ini > "$work/.final-buildid"
    # ...and checks against the commit the tree was made from that nothing
    # compiled has changed since.
    head -1 "$src/.vanta-applied" > "$work/.final-commit"
    ;;
  *) echo "unknown stage: $stage" >&2; exit 1 ;;
esac
