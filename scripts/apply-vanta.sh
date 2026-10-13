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
# Short name "Vanta" (app, menus, dock); full name "Vanta Browser" (about
# dialog, window titles where Firefox says "Mozilla Firefox").
sed -i.bak -E -e 's/^(-brand-(shorter|short|shortcut)-name) = .*/\1 = Vanta/' \
              -e 's/^(-brand-full-name) = .*/\1 = Vanta Browser/' \
  browser/branding/vanta/locales/en-US/brand.ftl
sed -i.bak -E -e 's/^(brandShorterName|brandShortName)=.*/\1=Vanta/' \
              -e 's/^(brandFullName)=.*/\1=Vanta Browser/' \
  browser/branding/vanta/locales/en-US/brand.properties
find browser/branding/vanta -name '*.bak' -delete
# Vanta's own icons (rendered from branding/logo.svg by scripts/make-branding.py).
cp -R "$here/branding/vanta/." browser/branding/vanta/
# macOS: use firefox.icns (our icon) instead of the AppIcon in the unofficial
# branding's compiled Assets.car, which still holds the generic icon.
python3 - <<'EOF'
path = "browser/app/macbuild/Contents/Info.plist.in"
text = open(path).read()
text = text.replace("\t<key>CFBundleIconName</key>\n\t<string>AppIcon</string>\n", "")
open(path, "w").write(text)
EOF

# Default prefs: Firefox reads browser/app/profile/firefox.js as built-in
# defaults, so our pref() lines go at the end and win over earlier ones.
if ! grep -q 'Vanta browser: default prefs' browser/app/profile/firefox.js; then
  { echo; cat "$here/prefs/vanta.js"; } >> browser/app/profile/firefox.js
fi

# Interface: ship chrome/vanta.css (plus chrome/split-view.css) as
# chrome://browser/skin/vanta.css and link it last from the main window, so it
# overrides Firefox's own chrome styles.
cat "$here/chrome/vanta.css" "$here/chrome/split-view.css" > browser/themes/shared/vanta.css
python3 - <<'EOF'
import sys

def insert(path, marker, anchor, line, before=False):
    text = open(path).read()
    if marker in text:
        return
    if text.count(anchor) != 1:
        sys.exit(f"apply-vanta: expected one '{anchor}' in {path}")
    text = text.replace(anchor, line + anchor if before else anchor + line)
    open(path, "w").write(text)

insert("browser/themes/shared/jar.inc.mn", "vanta.css",
       "(../shared/browser-shared.css)\n",
       "  skin/classic/browser/vanta.css                               (../shared/vanta.css)\n")
insert("browser/base/content/browser.xhtml", "chrome://browser/skin/vanta.css",
       '  <link rel="localization" href="branding/brand.ftl"/>\n',
       '  <link rel="stylesheet" href="chrome://browser/skin/vanta.css" />\n\n',
       before=True)
EOF

# Our own patches, if any.
for p in "$here"/patches/*.patch; do
  [ -e "$p" ] || continue
  # Skip patches that are already in, so the script can run twice.
  if patch -p1 -R -s -f --dry-run < "$p" >/dev/null 2>&1; then
    continue
  fi
  patch -p1 --forward < "$p"
done
