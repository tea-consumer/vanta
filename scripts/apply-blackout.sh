#!/usr/bin/env bash
# Add Blackout, Vanta's built-in ad and tracker blocker, to an unpacked
# Firefox source tree. Called by apply-vanta.sh; safe to run twice.
# Usage: scripts/apply-blackout.sh <firefox-source-dir>
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="${1:?usage: apply-blackout.sh <firefox-source-dir>}"
cd "$src"

# The content classifier changes between Firefox releases, so there is one
# patch per major version.
major="$(cut -d. -f1 < browser/config/version.txt)"
patch_file="$here/blackout/patches/firefox-$major.patch"
if [ ! -f "$patch_file" ]; then
  echo "apply-blackout: no Blackout patch for Firefox $major yet" >&2
  exit 1
fi

# New files: the list updater and element-hiding actors, and the engine
# cache and element-hiding glue for the content classifier.
cp -R "$here/blackout/gecko/." .
chmod -R u+w browser/components/blackout \
  toolkit/components/content-classifier/content_classifier_engine/src/blackout.rs

# Changes to Firefox's own files: the "blackout" classifier feature.
if ! patch -p1 -R -s -f --dry-run < "$patch_file" >/dev/null 2>&1; then
  patch -p1 --forward < "$patch_file"
fi

if ! grep -q 'Blackout: Vanta' browser/app/profile/firefox.js; then
  { echo; cat "$here/prefs/blackout.js"; } >> browser/app/profile/firefox.js
fi
