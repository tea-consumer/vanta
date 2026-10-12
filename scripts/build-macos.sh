#!/usr/bin/env bash
# Build Vanta on macOS (Apple Silicon). Needs Xcode + command line tools.
# Output: a .dmg in work/firefox-<version>/obj-vanta/dist/
#
# Env knobs:
#   VANTA_PGO=0         skip profile-guided optimization (faster build, slower browser)
#   VANTA_LINKER=ld64   link with Xcode's ld64 like Mozilla's release builds (default: lld)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(cat "$here/FIREFOX_VERSION")"
work="$here/work"
src="$work/firefox-$version"
mkdir -p "$work"

if [ ! -d "$src" ]; then
  tarball="$work/firefox-$version.source.tar.xz"
  base="https://archive.mozilla.org/pub/firefox/releases/$version"
  curl -fL -o "$tarball" "$base/source/firefox-$version.source.tar.xz"
  # Verify against Mozilla's published checksums.
  expected="$(curl -fsSL "$base/SHA512SUMS" | awk -v f="source/firefox-$version.source.tar.xz" '$2==f {print $1}')"
  actual="$(shasum -a 512 "$tarball" | awk '{print $1}')"
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "checksum mismatch" >&2; exit 1; }
  tar -xJf "$tarball" -C "$work"
fi

"$here/scripts/apply-vanta.sh" "$src"
cd "$src"
export MOZCONFIG="$here/mozconfigs/macos-a18"
./mach --no-interactive bootstrap --application-choice browser

if [ "${VANTA_PGO:-1}" = 0 ]; then
  ./mach build
else
  # Same three stages Mozilla uses for release Firefox, with cross-language
  # PGO so Rust code is profiled too (MOZ_PGO=1 in a mozconfig only does C++).
  export VANTA_PGO_DIR="$work/pgo"
  instr="$src/obj-vanta-instrumented"
  rm -rf "$VANTA_PGO_DIR"
  mkdir -p "$VANTA_PGO_DIR"

  # 1. Instrumented build. Packaging it is needed for the jar-order log.
  VANTA_PGO_STAGE=generate ./mach build
  VANTA_PGO_STAGE=generate ./mach package

  # 2. Training run: profileserver.py opens the instrumented build on
  #    Mozilla's own set of pages and merges the profiles into merged.profdata.
  llvm_profdata="$(sed -n 's/^LLVM_PROFDATA *= *//p' "$instr/config/autoconf.mk")"
  [ -n "$llvm_profdata" ] || { echo "llvm-profdata not found" >&2; exit 1; }
  (
    cd "$instr"
    rm -f ./*.profraw merged.profdata
    VANTA_PGO_STAGE=generate LLVM_PROFDATA="$llvm_profdata" \
      JARLOG_FILE="$VANTA_PGO_DIR/en-US.log" \
      "$src/mach" python "$src/build/pgo/profileserver.py"
  )
  cp "$instr/merged.profdata" "$VANTA_PGO_DIR/merged.profdata"

  # 3. Final optimized build using the profile, with cross-language LTO.
  export VANTA_PGO_STAGE=use
  ./mach build
fi

./mach package
ls -1 obj-vanta/dist/*.dmg
