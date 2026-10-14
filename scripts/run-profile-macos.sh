#!/usr/bin/env bash
# PGO training run on the Mac, step 2 of scripts/build-macos-cross.sh.
# Usage: scripts/run-profile-macos.sh <vanta-instrumented.dmg>
# Output: work/vanta-profile.tar (raw .profraw profiles + en-US.log), to send
# back to the Linux machine for the final build.
#
# Opens the instrumented Vanta on Mozilla's own training pages (build/pgo,
# including Speedometer 3) for about 20 minutes. Leave the Mac alone meanwhile.
# The profiles are not merged here: the Linux side merges them with the
# llvm-profdata that matches its clang.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(cat "$here/FIREFOX_VERSION")"
work="$here/work"
src="$work/firefox-$version"
dmg="$(cd "$(dirname "${1:?usage: run-profile-macos.sh <vanta-instrumented.dmg>}")" && pwd)/$(basename "$1")"

# The training pages and mach's Python helpers come from the Firefox source.
"$here/scripts/fetch-firefox.sh" "$work" >/dev/null

app_dir="$work/pgo-app"
run_dir="$work/pgo-run"
rm -rf "$app_dir" "$run_dir"
mkdir -p "$app_dir" "$run_dir"
mnt="$(mktemp -d)"
hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "$dmg" >/dev/null
cp -R "$mnt"/*.app "$app_dir/"
hdiutil detach "$mnt" >/dev/null
app="$(ls -d "$app_dir"/*.app | head -1)"
# Unsigned build copied off a disk image: clear quarantine so it can start.
xattr -dr com.apple.quarantine "$app" 2>/dev/null || true

cd "$run_dir"
unset LLVM_PROFDATA
JARLOG_FILE="$run_dir/en-US.log" \
  "$src/mach" python "$src/build/pgo/profileserver.py" --binary "$app/Contents/MacOS/vanta"

ls ./*.profraw >/dev/null
[ -s en-US.log ] || { echo "en-US.log was not written" >&2; exit 1; }
tar -cf "$work/vanta-profile.tar" ./*.profraw en-US.log
ls -lh "$work/vanta-profile.tar"
