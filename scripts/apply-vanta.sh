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
  echo "apply-vanta: already applied to $src (from $(head -1 .vanta-applied))" >&2
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

# Blackout, the built-in ad and tracker blocker.
bash "$here/scripts/apply-blackout.sh" "$PWD"

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
  # Skip patches that are already in, so the script can run twice.
  if patch -p1 -R -s -f --dry-run < "$p" >/dev/null 2>&1; then
    continue
  fi
  patch -p1 --forward < "$p"
done

# Experimental patches, only when asked for by name, e.g.
#   VANTA_EXPERIMENTAL="frame-readback" scripts/build-macos-cross.sh ...
# Each name matches patches/experimental/*<name>.patch; a .js file of the
# same name holds the prefs that go with it.
for name in ${VANTA_EXPERIMENTAL:-}; do
  p="$(ls "$here"/patches/experimental/*"$name".patch 2>/dev/null | head -1)"
  [ -n "$p" ] || { echo "apply-vanta: no experimental patch named $name" >&2; exit 1; }
  patch -p1 --forward < "$p"
  if [ -f "${p%.patch}.js" ]; then
    { echo; cat "${p%.patch}.js"; } >> browser/app/profile/firefox.js
  fi
done

# Vanta's own cookie banner rules (packaged by patches/cookiebanners-2).
cp "$here"/cookiebanners/vanta-rules.json "$here"/cookiebanners/vanta-site-rules.json \
  toolkit/components/cookiebanners/

# Line 1: the commit applied. Line 2: experimental patches, if any.
{
  git -C "$here" rev-parse HEAD 2>/dev/null || echo unknown
  [ -z "${VANTA_EXPERIMENTAL:-}" ] || echo "experimental: $VANTA_EXPERIMENTAL"
} > .vanta-applied
