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

# ModifiedCopy's macro, built for the Mac by SwiftPM (Xcode 27 builds it for
# iOS inside the app build). build-sim.sh loads it with -load-plugin-executable.
rm -rf firefox-ios/VantaPackages && mkdir -p firefox-ios/VantaPackages
cp -R "$ROOT/ios/packages/ModifiedCopy" firefox-ios/VantaPackages/ModifiedCopy
MACRO="$(dirname "$DEST")/modifiedcopy-macro"
if [ ! -x "$MACRO/plugin/ModifiedCopyMacros-tool" ]; then
  rm -rf "$MACRO" && mkdir -p "$MACRO"
  git clone -q https://github.com/WilhelmOks/ModifiedCopyMacro.git "$MACRO/src"
  git -C "$MACRO/src" checkout -q d020bf8c6432d0c6aa8428b5ca1c3225a0545b3b
  swift build --package-path "$MACRO/src" -c release -j 2 --product ModifiedCopyClient
  mkdir -p "$MACRO/plugin"
  cp "$(find "$MACRO/src/.build" -type f -perm -u+x -name 'ModifiedCopyMacros-tool' | head -1)" "$MACRO/plugin/"
  rm -rf "$MACRO/src"
fi

# From Mozilla's bootstrap.sh, without its SwiftLint download and git hooks.
if [ ! -x firefox-ios/bin/nimbus-fml.sh ]; then
  curl --proto '=https' --tlsv1.2 -sSf \
    https://raw.githubusercontent.com/mozilla/application-services/main/components/nimbus/ios/scripts/bootstrap.sh |
    bash -s -- --directory ./firefox-ios/bin ./firefox-ios/nimbus.fml.yaml
fi
npm install --no-audit --no-fund
npm run build

echo "Ready: $DEST ($TAG + Vanta)"
