#!/usr/bin/env bash
# Apply Vanta's changes to an unpacked Firefox source tree.
# Usage: scripts/apply-vanta.sh <firefox-source-dir>
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="${1:?usage: apply-vanta.sh <firefox-source-dir>}"
cd "$src"

# Apply once per fresh tree: the cookie banner patch pair cannot be detected
# as already applied, so a second run would half-apply it. To pick up new
# changes, start from a fresh tree (or use scripts/repack-ui.sh for the
# interface and prefs).
if [ -f .vanta-applied ]; then
  echo "apply-vanta: already applied to $src (from $(cat .vanta-applied))" >&2
  exit 0
fi

# Keep the scrolling path out of PGO. The training run never scrolls with a
# trackpad, so PGO marks the native event handling (widget/cocoa) and async
# scrolling (gfx/layers) as cold and optimizes it for size, which made
# trackpad scrolling choppy. These directories get the normal -O3 build.
for d in widget/cocoa gfx/layers; do
  grep -q '^NO_PGO = True' "$d/moz.build" ||
    printf '\n# Vanta: no PGO for the scrolling path.\nNO_PGO = True\n' >> "$d/moz.build"
done

# Branding: start from Firefox's own "unofficial" branding, rename it to Vanta.
rm -rf browser/branding/vanta
cp -r browser/branding/unofficial browser/branding/vanta
sed -i.bak -e 's/^MOZ_APP_DISPLAYNAME=.*/MOZ_APP_DISPLAYNAME=Vanta/' \
           -e 's/^MOZ_MACBUNDLE_ID=.*/MOZ_MACBUNDLE_ID=vanta/' \
  browser/branding/vanta/configure.sh
sed -i.bak -E 's/^(-brand-(shorter|short|shortcut|full)-name) = .*/\1 = Vanta/' \
  browser/branding/vanta/locales/en-US/brand.ftl
sed -i.bak -E 's/^(brandShorterName|brandShortName|brandFullName)=.*/\1=Vanta/' \
  browser/branding/vanta/locales/en-US/brand.properties
find browser/branding/vanta -name '*.bak' -delete

# Default prefs: Firefox reads browser/app/profile/firefox.js as built-in
# defaults, so our pref() lines go at the end and win over earlier ones.
if ! grep -q 'Vanta browser: default prefs' browser/app/profile/firefox.js; then
  { echo; cat "$here/prefs/vanta.js"; } >> browser/app/profile/firefox.js
fi

# Our own patches, if any.
for p in "$here"/patches/*.patch; do
  [ -e "$p" ] || continue
  patch -p1 --forward < "$p"
done

git -C "$here" rev-parse HEAD > .vanta-applied 2>/dev/null || echo unknown > .vanta-applied
