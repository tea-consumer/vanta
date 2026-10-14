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
       content classifier: "blackout" engine checks the URL      ~5 us
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
  sheet. Generic rules (the ones meant for every site, tens of thousands of
  `##.ad-slot` style rules) are matched to the page instead of sent whole:
  when the browser is idle after DOMContentLoaded, after load and once more
  5 s later, the actor lists the CSS classes and ids the page uses and gets
  back only the rules that target them. Pages with nothing to hide get no
  sheet and no style work.
- **Lists** are downloaded into `<profile>/blackout/lists/` on first start and
  refreshed daily with conditional requests (ETag / If-Modified-Since), so an
  unchanged list costs one empty 304 response. After a change the engine is
  rebuilt on a background thread and cached as `<profile>/blackout/engine.dat`.
  Every later start loads that cache instead of parsing the lists again.
- **Turning it off for a site** uses the existing shield in the address bar.
  Blocked ads and trackers appear there under "Tracking content", and the
  site toggle turns off both request blocking and element hiding.

## Default lists

The defaults are uBlock Origin's own default lists, so the two can be compared
like for like:

| List | What it adds | License |
|---|---|---|
| uBlock filters, badware, privacy, quick fixes, unbreak | uBlock Origin's own lists | GPLv3 |
| EasyList | Ads, international baseline | GPLv3 / CC BY-SA 3.0 |
| EasyPrivacy | Trackers and analytics | GPLv3 / CC BY-SA 3.0 |
| Peter Lowe's list | Ad and tracking servers | Free to use |
| Online Malicious URL Blocklist (URLhaus) | Malware sites | CC0 / MIT |

The set is one pref, `vanta.blackout.lists` (whitespace-separated `id=url`
entries), so adding or removing a list needs no rebuild. AdGuard Base, for
example, adds `adguard-base=https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt`
(1-2 us more per request, mostly more element hiding).

### uBlock Origin's list syntax

uBlock Origin's lists are written for uBlock Origin, so the engine glue
(`blackout.rs`) translates them as it loads them:

- `!#if` / `!#else` / `!#endif` blocks are evaluated as uBlock Origin on
  Firefox would (`env_firefox`, `ext_ublock`, `cap_user_stylesheet` hold;
  anything else, such as `env_chromium` or `cap_html_filtering`, does not).
- `@@...$redirect-rule` exceptions only switch off a redirect in uBlock Origin.
  The engine would read them as full exceptions and let the ad through, so
  they are dropped (Gecko does not redirect anyway).
- `$redirect=` rules are kept as plain blocks; `$redirect-rule` and
  `$removeparam` rules are dropped, since Gecko only asks whether to block and
  they would cost time on every request for nothing.
- `$denyallow=` becomes the rule plus exceptions for the allowed hosts (only
  for rules limited to some sites, where that means the same thing).
- `$~document` is dropped, since rules never apply to top-level pages unless
  they ask to.

What the engine still skips: `$popup` (popup windows are not network
requests the classifier sees), `$to=`, `$header=`, `$replace=`, `$urlskip=`
and a few other uBlock-only options, HTML filtering (`##^`) and regular
expressions with lookaround. Together with scriptlets (below) these are the
gap to uBlock Origin.

## Numbers

Both blockers measured on the same machine (cloud x86), on the same lists
(the defaults above, 9 lists) and the same 205,560 real requests from 2,000
sites (the request set adblock-rust benchmarks with). Blackout is timed the
way Gecko calls it (hosts already parsed, block or not); uBlock Origin's own
engine (`@gorhill/ubo-core` 0.1.30, with WASM and the real public suffix
list) is timed through its `matchRequest`, after a warm-up pass.

| | Blackout | uBlock Origin |
|---|---|---|
| Requests blocked | 83,581 | 83,584 |
| Network check | **5.2 us** per request | 5.9 us |
| Start with cached engine | **35 ms** | 210 ms |
| First start or list update | **0.2-0.3 s** | 1.0 s |
| Engine memory | **12.5 MB** | at least 49 MB |

Blackout blocks every request uBlock Origin blocks but 3 (one script on
nbcnews.com that only a regular expression with lookahead catches), and
nothing uBlock Origin lets through. The per-request time is the engine alone; in the browser uBlock
Origin also pays for each request's trip to its extension process, which
Blackout does not make. Blackout's lead on the network check comes from one
change to Firefox's matching code (below); without it the two are even.

Element hiding: site rules for nytimes.com are 13 rules in 0.1 ms;
browserbench.org gets none. Matching a page's classes and ids to generic
rules takes 0.1-0.25 ms on the classifier thread (cnn.com: 1,062 classes and
294 ids, 14 rules).

To reproduce: `blackout/bench` (`cargo run --release -- <lists> <requests.tsv>`,
with `BLACKOUT_DECISIONS=<file>` to save its decisions) and
`blackout/bench/compare` (`requests.py` converts adblock-rust's
`data/requests.json`; `ubo.mjs` runs uBlock Origin's engine).

### The matching change

Firefox's filter engine looked for substrings with `memchr::memmem::find`,
which builds a new searcher on every call. On short URLs and host names that
setup costs more than the search, and it was the largest single cost of a
check. The patch replaces it in `network_matchers.rs` (vendored `adblock`
crate in 157, in-tree `etp_engine` in 158) with a plain first-byte scan that
returns the same results; that is the 13% that puts Blackout ahead.

### Speedometer

Speedometer 3.1 on the Mac scored 39.6 without Blackout, and Blackout must not
lower it. Why it should not:

- Every request already goes through ETP's classifier thread in Strict mode.
  Blackout adds one engine lookup inside that same step, not a new thread hop.
- browserbench.org gets no element-hiding rules, so no style sheet is added.
- The class and id survey runs only when the browser is idle, three times per
  page, and adds rules only for classes and ids that lists target.
- The other generic rules (about 550 selectors every page would get, mostly
  attribute selectors such as `a[href^="..."]`) are off by default
  (`vanta.blackout.cosmetic.generic_complex`). uBlock Origin applies them;
  they would add style-matching work to every page.

This still has to be confirmed on the real build: run Speedometer 3.1 with
`privacy.trackingprotection.content.protection.enabled` on and off.

## Prefs

| Pref | Default | |
|---|---|---|
| `privacy.trackingprotection.content.protection.enabled` | `true` | Master switch (Firefox's pref) |
| `privacy.trackingprotection.content.protection.engines` | `blackout` | Engines that block, normal windows |
| `privacy.trackingprotection.content.protection.engines.pbmode` | `blackout` | Same, private windows |
| `vanta.blackout.lists` | 9 lists | `id=url` entries |
| `vanta.blackout.update_interval` | `86400` | Seconds between list refreshes |
| `vanta.blackout.cosmetic.enabled` | `true` | Element hiding |
| `vanta.blackout.cosmetic.generic` | `true` | Generic element hiding, matched to the page's classes and ids |
| `vanta.blackout.cosmetic.generic_complex` | `false` | The other generic rules, on every page |

ETP Strict and its Disconnect lists keep running alongside Blackout.

## Code

- `blackout/patches/firefox-<major>.patch`: changes to Firefox's own files, one
  patch per Firefox major version (157, 158): the `blackout` feature in
  `ContentClassifierService.cpp`, the engine-cache and element-hiding entry
  points in the engine glue, `getCosmeticStyle()` and `getClassIdStyle()` on
  `nsIContentClassifierService`, the matching change, and the startup hooks.
- `blackout/gecko/`: new files copied into the tree.
  `content_classifier_engine/src/blackout.rs` translates uBlock Origin's list
  syntax, builds and caches the engine and writes element-hiding style sheets; `browser/components/blackout/` holds the
  list updater and the element-hiding actors.
- `prefs/blackout.js`: the prefs above.
- `scripts/apply-blackout.sh`: applies all of it; `apply-vanta.sh` calls it.
- `blackout/bench/`: the benchmark behind the numbers above
  (`cargo run --release -- <folder with *.txt lists> [requests.tsv]`). It
  builds against crates.io's `adblock` 0.12.1, without the matching change;
  to include it, point a `[patch.crates-io]` entry at the patched
  `third_party/rust/adblock` of a Firefox 157 tree.
- `blackout/bench/compare/`: the uBlock Origin side of the comparison.

## Not in this version

- Scriptlets (`##+js`): the small scripts lists inject to defeat anti-adblock
  and YouTube's in-video ads. Vanta is getting its own implementations under
  the names the lists use (uBlock Origin's are GPLv3 code from another
  project). Until then those rules do nothing. Rules that redirect are
  applied as plain blocks; Firefox's SmartBlock shims still replace the
  common trackers (Google Analytics, Tag Manager and so on) so sites that
  expect them keep working.
- The uBlock-only options listed above, and procedural element hiding
  (`:has-text()`, `:upward()` and the like).
- A Blackout panel or blocked-count badge. The shield already shows what was
  blocked; a Vanta-styled view can follow.

## Checking a build

- `about:url-classifier` has a content classifier section where a URL can be
  probed against the `blackout` feature.
- Logs: set `MOZ_LOG=ContentClassifier:5`, and `vanta.blackout.loglevel` to
  `Debug` for the list updater.
- First start: `<profile>/blackout/lists/` fills with nine `.txt` files and
  `engine.dat` appears a moment later.
