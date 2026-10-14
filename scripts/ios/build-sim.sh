#!/usr/bin/env bash
# Vanta for iOS: build for the iOS Simulator, install it in one simulator and
# take screenshots of the new tab and a page. No signing, nothing touches a
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

xcodebuild -project Client.xcodeproj -scheme Fennec \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED" -jobs "$JOBS" -skipMacroValidation \
  COMPILER_INDEX_STORE_ENABLE=NO CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
  build 2>&1 | grep -E 'error:|warning: unre|\*\* BUILD' || true

APP=$(find "$DERIVED/Build/Products" -maxdepth 2 -name 'Client.app' -path '*iphonesimulator*' | head -1)
[ -n "$APP" ] || { echo "Build failed: no Client.app"; exit 1; }

# One simulator, reused on every run.
UDID=$(xcrun simctl list devices available | grep -F "$DEVICE_NAME (" | head -1 | grep -oE '[0-9A-F-]{36}' || true)
if [ -z "$UDID" ]; then
  TYPE=$(xcrun simctl list devicetypes | grep -E '^iPhone [0-9]+ Pro \(' | tail -1 | grep -oE 'com\.apple[^)]+')
  RUNTIME=$(xcrun simctl list runtimes available | grep -E '^iOS' | tail -1 | grep -oE 'com\.apple[^ ]+$')
  UDID=$(xcrun simctl create "$DEVICE_NAME" "$TYPE" "$RUNTIME")
fi
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl ui "$UDID" appearance dark
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3

BUNDLE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
sleep 8
xcrun simctl io "$UDID" screenshot "$OUT/1-new-tab.png"
xcrun simctl openurl "$UDID" "fennec://open-url?url=https%3A%2F%2Fduckduckgo.com%2F%3Fq%3Dsolar%2Beclipse"
sleep 8
xcrun simctl io "$UDID" screenshot "$OUT/2-page.png"
echo "Screenshots in $OUT"
