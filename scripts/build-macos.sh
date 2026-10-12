#!/usr/bin/env bash
# Build Vanta on macOS (Apple Silicon). Needs Xcode + command line tools.
# Output: a .dmg in work/firefox-<version>/obj-vanta/dist/
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
./mach build
./mach package
ls -1 obj-vanta/dist/*.dmg
