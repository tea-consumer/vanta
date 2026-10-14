#!/usr/bin/env bash
# Download and unpack the Firefox release source pinned in FIREFOX_VERSION,
# checked against Mozilla's published SHA512SUMS. Does nothing if the tree is
# already there. Prints the source directory.
# Usage: scripts/fetch-firefox.sh <work-dir>
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(cat "$here/FIREFOX_VERSION")"
work="${1:?usage: fetch-firefox.sh <work-dir>}"
src="$work/firefox-$version"

if [ ! -d "$src" ]; then
  mkdir -p "$work"
  tarball="$work/firefox-$version.source.tar.xz"
  base="https://archive.mozilla.org/pub/firefox/releases/$version"
  curl -fL -o "$tarball" "$base/source/firefox-$version.source.tar.xz" >&2
  expected="$(curl -fsSL "$base/SHA512SUMS" | awk -v f="source/firefox-$version.source.tar.xz" '$2==f {print $1}')"
  if command -v sha512sum >/dev/null; then
    actual="$(sha512sum "$tarball" | awk '{print $1}')"
  else
    actual="$(shasum -a 512 "$tarball" | awk '{print $1}')"
  fi
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "checksum mismatch" >&2; exit 1; }
  tar -xJf "$tarball" -C "$work"
  rm -f "$tarball"
fi
echo "$src"
