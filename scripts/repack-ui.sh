#!/usr/bin/env bash
# Rebuild only Vanta's front end (interface CSS and default prefs) into an
# existing macOS build tree, with no compiling, and stage the two omni.ja
# archives for scripts/update-mac-ui.sh to swap into the installed app.
#
# Usage (on the Linux build machine):
#   scripts/repack-ui.sh [git refs to merge first...]
#   e.g. scripts/repack-ui.sh origin/main      (what's merged)
#        scripts/repack-ui.sh origin/pr/7      (try a PR before merging it)
#
# Refuses, and says so, when anything besides chrome/, prefs/ and
# front-end-only patches (CSS, JS, Fluent, markup) changed since the commit
# the installed build was made from: those need scripts/build-macos-cross.sh.
# Output: $VANTA_WORK/out/ui/{omni.ja,browser-omni.ja,SHA256SUMS}
set -euo pipefail
# Over ssh on NixOS the build tools aren't on PATH; rerun inside a nix shell
# with the libraries mach's helpers load (libclang, libstdc++, zlib, uuid).
if [ -e /etc/NIXOS ] && [ -z "${VANTA_IN_NIX:-}" ]; then
  libs="$(nix build --no-link --print-out-paths nixpkgs#stdenv.cc.cc.lib nixpkgs#zlib.out nixpkgs#util-linux.lib | sed 's|$|/lib|' | paste -sd:)"
  VANTA_IN_NIX=1 LD_LIBRARY_PATH="$libs" exec nix shell nixpkgs#python3 nixpkgs#gnumake \
    nixpkgs#perl nixpkgs#m4 nixpkgs#unzip nixpkgs#zip nixpkgs#which nixpkgs#xz nixpkgs#gawk \
    nixpkgs#zstd nixpkgs#git -c bash "$0" "$@"
fi
here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(cat "$here/FIREFOX_VERSION")"
work="${VANTA_WORK:?set VANTA_WORK to the build work dir}"
src="$work/firefox-$version"
obj="$src/obj-vanta"
[ -d "$obj" ] || { echo "no final build in $obj" >&2; exit 1; }

cd "$here"
before="$(git rev-parse HEAD)"
if [ "$#" -gt 0 ]; then
  git fetch -q origin main '+refs/pull/*/head:refs/remotes/origin/pr/*'
  for ref in "$@"; do
    git -c user.name=Vanta -c user.email=vanta@localhost merge -q --no-edit "$ref" || { git merge --abort; echo "merge of $ref conflicts" >&2; exit 1; }
  done
fi
# Compare with the commit the final build was made from, when it's known.
built="$before"
if [ -f "$work/.final-commit" ] && git cat-file -e "$(cat "$work/.final-commit")^{commit}" 2>/dev/null; then
  built="$(cat "$work/.final-commit")"
fi
# A patch is front-end only when every file it touches is packaged into
# omni.ja as is (no C++, Rust, build files or static prefs).
frontend_patch() {
  [ -z "$(git show "$1" | sed -n 's|^+++ b/||p' |
    grep -vE '\.(css|mjs|js|ftl|xhtml|html|svg|json)$' || true)" ]
}
# Sort every changed file by what it does to the shipped app:
#   - doesn't ship (docs, tests, tools, build scripts): ignored
#   - chrome CSS, prefs/vanta.js, front-end-only patches: repacked below
#   - front-end files copied into the tree as is (Blackout and Vanta modules,
#     cookie banner rules): copied again below
#   - anything else (C++, Rust, build files, icons, toolchain): full build
frontend_file='\.(css|mjs|js|ftl|xhtml|html|svg|json)$'
changed_patches=""
copied=""
other=""
while IFS=$'\t' read -r status path; do
  [ -n "$path" ] || continue
  case "$path" in
    *.md|docs/*|.claude/*|.github/*|tools/*|blackout/test/*|blackout/bench/*|\
    patches/experimental/*|branding/src/*|.gitignore|flake.nix) continue ;;
    scripts/apply-vanta.sh|scripts/apply-blackout.sh) other="$other$path"$'\n'; continue ;;
    scripts/*) continue ;;
    chrome/*|prefs/vanta.js) continue ;;
    patches/*/*) other="$other$path"$'\n' ;;
    patches/*.patch)
      if { [ -z "$(git ls-tree "$built" "$path")" ] || frontend_patch "$built:$path"; } &&
         { [ -z "$(git ls-tree HEAD "$path")" ] || frontend_patch "HEAD:$path"; }; then
        changed_patches="$changed_patches $path"
      elif [ -f "$here/$path" ] &&
           (cd "$src" && patch -p1 -R -s -f --dry-run < "$here/$path" >/dev/null 2>&1); then
        : # already in the build (e.g. it was built in as an experimental patch)
      else
        other="$other$path"$'\n'
      fi ;;
    blackout/gecko/*|gecko/*|cookiebanners/*.json)
      if [ "$status" != D ] && [[ "$path" =~ $frontend_file ]]; then
        copied="$copied $path"
      else
        other="$other$path"$'\n'
      fi ;;
    *) other="$other$path"$'\n' ;;
  esac
done < <(git diff --name-status --no-renames "$built" HEAD)
other="${other%$'\n'}"
if [ -n "$other" ]; then
  git reset -q --hard "$before"
  printf 'needs a full rebuild, these changed:\n%s\n' "$other" >&2
  exit 2
fi

# Front-end patches: take out the old version, put in the new one.
for p in $changed_patches; do
  if [ -n "$(git ls-tree "$built" "$p")" ]; then
    git show "$built:$p" > "$work/.old.patch"
    if (cd "$src" && patch -p1 -R -s -f --dry-run < "$work/.old.patch" >/dev/null 2>&1); then
      (cd "$src" && patch -p1 -R -s < "$work/.old.patch")
    fi
  fi
  if [ -f "$here/$p" ] && ! (cd "$src" && patch -p1 -R -s -f --dry-run < "$here/$p" >/dev/null 2>&1); then
    (cd "$src" && patch -p1 --forward < "$here/$p")
  fi
done
rm -f "$work/.old.patch"

# Front-end files apply-vanta.sh and apply-blackout.sh copy in as is.
for f in $copied; do
  case "$f" in
    blackout/gecko/*) dest="${f#blackout/gecko/}" ;;
    gecko/*) dest="${f#gecko/}" ;;
    cookiebanners/*) dest="toolkit/components/cookiebanners/${f#cookiebanners/}" ;;
  esac
  mkdir -p "$src/$(dirname "$dest")"
  cp "$here/$f" "$src/$dest"
done

# Interface CSS: regenerated whole, the same way apply-vanta.sh builds it.
cat "$here/chrome/vanta.css" "$here/chrome/split-view.css" > "$src/browser/themes/shared/vanta.css"

# Prefs: swap the previously applied copy of prefs/vanta.js for the new one.
applied="$work/.applied-vanta.js"
python3 - "$src/browser/app/profile/firefox.js" "$applied" "$here/prefs/vanta.js" <<'EOF'
import sys
target, old_path, new_path = sys.argv[1:]
text, old, new = (open(p).read() for p in (target, old_path, new_path))
if old not in text:
    sys.exit("repack-ui: the applied prefs block is not in firefox.js")
open(target, "w").write(text.replace(old, new, 1))
EOF
cp "$here/prefs/vanta.js" "$applied"

export PATH="$HOME/.rustup/toolchains/${VANTA_RUST:-1.95.0}-x86_64-unknown-linux-gnu/bin:$PATH"
export VANTA_ROOT="$here" MOZCONFIG="$here/mozconfigs/macos-a18-cross"
export VANTA_PGO_STAGE=use VANTA_PGO_DIR="$work/pgo" VANTA_LINKER="${VANTA_LINKER:-ld64}"
# Keep the build ID of the installed build, so the new front end's
# AppConstants match the compiled code they ship next to. Read it from the
# AppConstants the final build packaged, not from buildid.h: `build faster`
# doesn't regenerate that, and it can be stale.
app="$obj/dist/vanta/Vanta.app/Contents/Resources"
buildid="$(unzip -p "$app/omni.ja" modules/AppConstants.sys.mjs 2>/dev/null |
  sed -n 's/^ *MOZ_BUILDID: *"\([0-9]*\)".*/\1/p' | head -1 || true)"
[ -n "$buildid" ] || buildid="$(cat "$work/.final-buildid" 2>/dev/null || true)"
[ -n "$buildid" ] || { echo "repack-ui: can't find the installed build's build ID" >&2; exit 1; }
export MOZ_BUILD_DATE="$buildid"
cd "$src"
./mach --no-interactive build faster
./mach package

ui="$work/out/ui"
mkdir -p "$ui"
cp "$app/omni.ja" "$ui/omni.ja"
cp "$app/browser/omni.ja" "$ui/browser-omni.ja"
(cd "$ui" && sha256sum omni.ja browser-omni.ja > SHA256SUMS)
echo "staged in $ui ($(git -C "$here" rev-parse --short HEAD))"
