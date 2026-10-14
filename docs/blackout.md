# Blackout

Blackout is Vanta's built-in ad and tracker blocker. It is not an extension:
it runs inside Firefox's own **content classifier**
(`toolkit/components/content-classifier`), the native filter-list engine
Mozilla added to Enhanced Tracking Protection. Firefox 157 already ships it,
switched off and without lists. Blackout turns it on, adds a `blackout`
feature to it, and feeds it public ad and tracker lists.

Everything Blackout adds is Firefox source plus Vanta's own code in this repo.
The engine is Firefox's vendored `adblock` crate (157) or its in-tree fork
`etp_engine` (158), both MPL-2.0. Filter lists are data, downloaded at runtime
from their maintainers, never bundled.

## How it works

```
page asks for https://ads.example/tag.js
  -> nsHttpChannel::AsyncOpen
  -> URL classifier worker thread (already used by ETP for every request)
       content classifier: "blackout" engine checks the URL      ~3 us
  -> main thread: blocked? cancel with NS_ERROR_TRACKING_URI
     (same path as ETP: shield icon, SmartBlock shims, per-site toggle)
```

- **Network blocking** happens before any connection is made, off the main
  thread, on the thread ETP's classifier already runs every request through.
  Blackout matches every request, first party included, against the frame that
  made it, like a classic ad blocker. Top-level page loads are only blocked by
  rules that ask for it (`$document`), which is how the lists are written.
- **Element hiding** (`##` rules): when a page's document starts, a small window
  actor asks the parent process for that site's rules. The engine answers on
  the same classifier thread, and the actor applies them as one user style
  sheet. Pages with nothing to hide get no sheet and no style work.
- **Lists** are downloaded into `<profile>/blackout/lists/` on first start and
  refreshed daily with conditional requests (ETag / If-Modified-Since), so an
  unchanged list costs one empty 304 response. After a change the engine is
  rebuilt on a background thread and cached as `<profile>/blackout/engine.dat`.
  Every later start loads that cache instead of parsing the lists again.
- **Turning it off for a site** uses the existing shield in the address bar.
  Blocked ads and trackers appear there under "Tracking content", and the
  site toggle turns off both request blocking and element hiding.

## Default lists

| List | What it adds | License |
|---|---|---|
| EasyList | Ads, international baseline | GPLv3 / CC BY-SA 3.0 |
| EasyPrivacy | Trackers and analytics | GPLv3 / CC BY-SA 3.0 |
| Peter Lowe's list | Ad and tracking servers | Free to use |
| AdGuard Base (without EasyList) | Ads EasyList misses, many non-English | GPLv3 |

The set is one pref, `vanta.blackout.lists` (whitespace-separated `id=url`
entries), so adding or removing a list needs no rebuild.

Not in the defaults, on purpose:

- **uBlock Origin's lists** use `!#if` / `!#include` preprocessor lines that
  this engine does not evaluate. Fed in raw, they apply rules meant for other
  platforms. Supporting them needs a small preprocessor first.
- **AdGuard Tracking Protection** triples engine memory (about 30 MB) for
  little over EasyPrivacy.
- **Annoyance lists** (cookie banners, newsletters): Firefox's own cookie
  banner handling covers the main case.

## Numbers

Measured with `blackout/bench` on the default four lists (213k lines), on a
cloud x86 machine. The engine code is the same on the Mac.

| | |
|---|---|
| Network check | about 3-4 us per request, on the classifier thread |
| Start with cached engine | 25-35 ms, on a background thread |
| First start or list update (parse + cache) | 200-290 ms, on a background thread |
| Engine memory | about 11 MB, in the parent process only (15 MB right after a list update, until the next start) |
| Element-hiding rules for nytimes.com | 32 rules, 2 KB, 0.1 ms |
| Element-hiding rules for browserbench.org | none |

For comparison: EasyList + EasyPrivacy alone is 1.9 us and 7 MB; adding
AdGuard Tracking Protection on top of the defaults is 4.1 us and 30 MB.

### Speedometer

Speedometer 3.1 on the Mac scored 39.6 without Blackout, and Blackout must not
lower it. Why it should not:

- Every request already goes through ETP's classifier thread in Strict mode.
  Blackout adds one engine lookup inside that same step, not a new thread hop.
- browserbench.org gets no element-hiding rules, so no style sheet is added.
- Generic element-hiding rules (the ones every site gets, about 500
  selectors including costly attribute selectors) are **off by default**
  (`vanta.blackout.cosmetic.generic`). They would add style-matching work to
  every page, Speedometer's included, for little gain once the ad requests
  themselves are blocked.

This still has to be confirmed on the real build: run Speedometer 3.1 with
`privacy.trackingprotection.content.protection.enabled` on and off.

## Prefs

| Pref | Default | |
|---|---|---|
| `privacy.trackingprotection.content.protection.enabled` | `true` | Master switch (Firefox's pref) |
| `privacy.trackingprotection.content.protection.engines` | `blackout` | Engines that block, normal windows |
| `privacy.trackingprotection.content.protection.engines.pbmode` | `blackout` | Same, private windows |
| `vanta.blackout.lists` | 4 lists | `id=url` entries |
| `vanta.blackout.update_interval` | `86400` | Seconds between list refreshes |
| `vanta.blackout.cosmetic.enabled` | `true` | Element hiding |
| `vanta.blackout.cosmetic.generic` | `false` | Generic element hiding |

ETP Strict and its Disconnect lists keep running alongside Blackout.

## Code

- `blackout/patches/firefox-<major>.patch`: changes to Firefox's own files, one
  patch per Firefox major version (157, 158): the `blackout` feature in
  `ContentClassifierService.cpp`, the engine-cache and element-hiding entry
  points in the engine glue, `getCosmeticStyle()` on
  `nsIContentClassifierService`, and the startup hooks.
- `blackout/gecko/`: new files copied into the tree.
  `content_classifier_engine/src/blackout.rs` builds and caches the engine and
  writes element-hiding style sheets; `browser/components/blackout/` holds the
  list updater and the element-hiding actors.
- `prefs/blackout.js`: the prefs above.
- `scripts/apply-blackout.sh`: applies all of it; `apply-vanta.sh` calls it.
- `blackout/bench/`: the benchmark behind the numbers above
  (`cargo run --release -- <folder with *.txt lists>`).

## Not in this version

- Scriptlet injection (`##+js`) and redirect resources (`$redirect`). They are
  what defeats anti-adblock scripts and YouTube's in-video ads, but the
  standard resource set is uBlock Origin's own JavaScript, and Vanta's ground
  rule is no code from other projects' browsers. Rules that redirect are
  applied as plain blocks; Firefox's SmartBlock shims still replace the
  common trackers (Google Analytics, Tag Manager and so on) so sites that
  expect them keep working.
- A Blackout panel or blocked-count badge. The shield already shows what was
  blocked; a Vanta-styled view can follow.

## Checking a build

- `about:url-classifier` has a content classifier section where a URL can be
  probed against the `blackout` feature.
- Logs: set `MOZ_LOG=ContentClassifier:5`, and `vanta.blackout.loglevel` to
  `Debug` for the list updater.
- First start: `<profile>/blackout/lists/` fills with four `.txt` files and
  `engine.dat` appears a moment later.
