#!/usr/bin/env bash
# Apply Vanta's changes to an unpacked Firefox source tree.
# Usage: scripts/apply-vanta.sh <firefox-source-dir>
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="${1:?usage: apply-vanta.sh <firefox-source-dir>}"
cd "$src"

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

# Vanta's own startup modules (gecko/ mirrors the Firefox tree layout).
cp "$here/gecko/browser/modules/VantaIntegrations.sys.mjs" browser/modules/
if ! grep -q VantaIntegrations browser/modules/moz.build; then
  printf '\nMOZ_SRC_FILES += ["VantaIntegrations.sys.mjs"]\n' >> browser/modules/moz.build
  printf '\n# Vanta\ncategory browser-idle-startup moz-src:///browser/modules/VantaIntegrations.sys.mjs VantaIntegrations.ensureNativeMessagingDir\n' \
    >> browser/components/BrowserComponents.manifest
fi

# Our own patches, if any.
for p in "$here"/patches/*.patch; do
  [ -e "$p" ] || continue
  patch -p1 --forward < "$p"
done
