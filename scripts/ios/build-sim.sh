#!/usr/bin/env bash
# Vanta for iOS: build for the iOS Simulator, install it in one simulator and
# take a screenshot of the new tab. No signing, nothing touches a
# phone. Run scripts/ios/prepare.sh first.
#
#   scripts/ios/build-sim.sh [work-dir] [out-dir]
#
# RAM: the Mac has 8 GB, so the compiler runs at most 2 jobs. Build products
# stay in <work-dir>/DerivedData, so removing the work dir removes everything.
set -euo pipefail

DEST=${1:-"$HOME/vanta-ios/firefox-ios"}
OUT=${2:-"$(dirname "$DEST")/screenshots"}
DEVICE_NAME=${VANTA_SIM_DEVICE:-"Vanta iPhone"}
JOBS=${VANTA_JOBS:-2}
DERIVED="$DEST/DerivedData"
mkdir -p "$OUT"
cd "$DEST/firefox-ios"

# One simulator, reused on every run (booted after the build).
UDID=$(xcrun simctl list devices available | grep -F "$DEVICE_NAME (" | head -1 | grep -oE '[0-9A-F-]{36}' || true)
if [ -z "$UDID" ]; then
  TYPE=$(xcrun simctl list devicetypes | grep -E '^iPhone [0-9]+ Pro \(' | tail -1 | grep -oE 'com\.apple[^)]+')
  RUNTIME=$(xcrun simctl list runtimes available | grep -E '^iOS' | tail -1 | grep -oE 'com\.apple[^ ]+$')
  UDID=$(xcrun simctl create "$DEVICE_NAME" "$TYPE" "$RUNTIME")
fi

# Build for that simulator the way Mozilla's Xcode 27 CI does (Debug, active
# arch only), without -sdk: it would also force the macro packages, which run
# on the Mac at compile time, to build for iOS.
MACRO="$(dirname "$DEST")/modifiedcopy-macro/plugin/ModifiedCopyMacros-tool"
[ -x "$MACRO" ] || { echo "Run prepare.sh first: no ModifiedCopy macro at $MACRO"; exit 1; }
xcodebuild -project Client.xcodeproj -scheme Fennec -configuration Debug \
  -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$DERIVED" -jobs "$JOBS" -skipMacroValidation \
  ONLY_ACTIVE_ARCH=YES \
  OTHER_SWIFT_FLAGS="\$(inherited) -load-plugin-executable $MACRO#ModifiedCopyMacros" \
  COMPILER_INDEX_STORE_ENABLE=NO CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
  build >"$(dirname "$DEST")/build.log" 2>&1 && BUILT=1 || BUILT=0
grep -E 'error:|\*\* BUILD' "$(dirname "$DEST")/build.log" | sort -u || true
[ "$BUILT" = 1 ] || { echo "Build failed, see $(dirname "$DEST")/build.log"; exit 1; }

APP=$(find "$DERIVED/Build/Products" -maxdepth 2 -name 'Client.app' -path '*iphonesimulator*' | head -1)
[ -n "$APP" ] || { echo "Build failed: no Client.app"; exit 1; }

# Boot only now, so the simulator doesn't hold RAM during the build.
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl ui "$UDID" appearance dark
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3

BUNDLE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
# A Debug build on a freshly booted simulator can take a while to draw its
# first frame; until then the screen is plain black and the PNG stays small.
rm -f "$OUT/2-page.png"
for _ in $(seq 24); do
  sleep 5
  xcrun simctl io "$UDID" screenshot "$OUT/1-new-tab.png" >/dev/null 2>&1
  [ "$(wc -c <"$OUT/1-new-tab.png")" -gt 150000 ] && break
done
echo "Screenshots in $OUT"
