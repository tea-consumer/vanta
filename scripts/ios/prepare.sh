#!/usr/bin/env bash
# Vanta for iOS: fetch Mozilla's Firefox for iOS at the pinned release, apply
# Vanta's patches and icon, and run the parts of Mozilla's bootstrap the build
# needs (Nimbus code generator, user scripts). macOS only.
#
#   scripts/ios/prepare.sh [work-dir]     default: ~/vanta-ios/firefox-ios
#
# The work dir is a plain checkout of firefox-ios that this script owns: every
# run resets it to the pinned tag before patching, so nothing piles up.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DEST=${1:-"$HOME/vanta-ios/firefox-ios"}
TAG=$(cat "$ROOT/ios/FIREFOX_IOS_VERSION")

if [ ! -d "$DEST/.git" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/mozilla-mobile/firefox-ios.git "$DEST"
fi
cd "$DEST"
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  git fetch --depth 1 origin tag "$TAG"
fi
git reset -q --hard "$TAG"

for patch in "$ROOT"/ios/patches/*.patch; do
  echo "Applying $(basename "$patch")"
  git apply "$patch"
done

ICON="$ROOT/ios/branding/AppIcon.png"
for set in AppIcon AppIcon_Beta AppIcon_Developer; do
  for name in appstore appstore-dark appstore-tinted; do
    cp "$ICON" "firefox-ios/Client/Assets/AppIcons.xcassets/$set.appiconset/$name.png"
  done
done

# From Mozilla's bootstrap.sh, without its SwiftLint download and git hooks.
if [ ! -x firefox-ios/bin/nimbus-fml.sh ]; then
  curl --proto '=https' --tlsv1.2 -sSf \
    https://raw.githubusercontent.com/mozilla/application-services/main/components/nimbus/ios/scripts/bootstrap.sh |
    bash -s -- --directory ./firefox-ios/bin ./firefox-ios/nimbus.fml.yaml
fi
npm install --no-audit --no-fund
npm run build

echo "Ready: $DEST ($TAG + Vanta)"
