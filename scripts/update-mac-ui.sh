#!/usr/bin/env bash
# One command on the Mac to pick up Vanta interface and prefs changes without
# rebuilding: asks the Linux build machine to repack the front end
# (scripts/repack-ui.sh), copies the two omni.ja archives back, and swaps them
# into /Applications/Vanta.app. The previous files are kept next to them as
# *.previous, so `update-mac-ui.sh --undo` puts them back.
#
# Usage: update-mac-ui.sh [git refs to merge first...] | --undo
# Build machine host and paths: scripts/machines.conf (or the env vars
# VANTA_BUILD_HOST, VANTA_BUILD_REPO, VANTA_WORK).
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/machines.conf"
host="$VANTA_BUILD_HOST"
repo="$VANTA_BUILD_REPO"
work="$VANTA_WORK"
res="/Applications/Vanta.app/Contents/Resources"

if pgrep -xq vanta; then
  echo "Quit Vanta first, then run this again." >&2
  exit 1
fi

if [ "${1:-}" = --undo ]; then
  mv "$res/omni.ja.previous" "$res/omni.ja"
  mv "$res/browser/omni.ja.previous" "$res/browser/omni.ja"
  codesign --force --deep -s - /Applications/Vanta.app
  echo "restored the previous interface files"
  exit 0
fi

refs=""
for r in "$@"; do refs="$refs $(printf %q "$r")"; done
ssh "$host" "VANTA_WORK=$(printf %q "$work") bash $(printf %q "$repo/scripts/repack-ui.sh")$refs"

tmp="$(mktemp -d)"
# OpenSSH 10's scp speaks SFTP, which doesn't expand braces; fetch each file.
for f in omni.ja browser-omni.ja SHA256SUMS; do
  ssh "$host" "cat $(printf %q "$work/out/ui/$f")" > "$tmp/$f"
done
(cd "$tmp" && shasum -a 256 -c SHA256SUMS >/dev/null) || { echo "checksum mismatch" >&2; exit 1; }

cp "$res/omni.ja" "$res/omni.ja.previous"
cp "$res/browser/omni.ja" "$res/browser/omni.ja.previous"
cp "$tmp/omni.ja" "$res/omni.ja"
cp "$tmp/browser-omni.ja" "$res/browser/omni.ja"
rm -rf "$tmp"
# The bundle's files changed, so refresh its ad-hoc signature.
codesign --force --deep -s - /Applications/Vanta.app
# Make Vanta reread its front end instead of using its startup cache.
# Vanta's unofficial branding keeps Firefox's vendor dir for caches.
for d in "$HOME"/Library/Caches/Firefox/Profiles/*/startupCache; do
  [ -d "$d" ] && rm -rf "$d"
done
echo "Vanta's interface and prefs are updated. Open Vanta."
