#!/usr/bin/env bash
# Try Vanta's interface on a stock Firefox, without building Vanta.
# Creates a throwaway profile with prefs/vanta.js as user prefs and
# chrome/vanta.css as its userChrome.css, then starts Firefox with it.
# Usage: scripts/preview-ui.sh [path-to-firefox-binary]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"

firefox="${1:-}"
if [ -z "$firefox" ]; then
  if [ -x /Applications/Firefox.app/Contents/MacOS/firefox ]; then
    firefox=/Applications/Firefox.app/Contents/MacOS/firefox
  else
    firefox="$(command -v firefox)"
  fi
fi

profile="$here/work/preview-profile"
rm -rf "$profile"
mkdir -p "$profile/chrome"
{
  sed -n -E 's/^(sticky_)?pref\(/user_pref(/p' "$here/prefs/vanta.js"
  # Stock Firefox only reads userChrome.css with this on.
  echo 'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);'
} > "$profile/user.js"
cp "$here/chrome/vanta.css" "$profile/chrome/userChrome.css"

exec "$firefox" --no-remote --profile "$profile"
