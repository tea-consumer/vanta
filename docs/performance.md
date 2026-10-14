# Vanta performance levers

Every speed and RAM lever checked against the Firefox 157.0.1 source
(`FIREFOX_157_0_1_RELEASE`), ranked by expected gain. "Applied" means it is in
this repo. Nothing here has been benchmarked yet; gains are estimates from
Mozilla's own numbers and how the code works, to be checked with
Speedometer 3, JetStream 2 and `about:memory` once there is a build.

## Applied

| # | Lever | Where | Gain | Risk |
|---|---|---|---|---|
| 1 | **Cross-language PGO on macOS.** `MOZ_PGO=1` in a mozconfig makes `mach build` profile only C++; the Rust half of Gecko (Stylo CSS engine, WebRender, encoding, ...) gets no profile. `build-macos.sh` now runs the three stages itself with `--enable-profile-generate=cross` / `--enable-profile-use=cross`, the same recipe as Mozilla's release builds (`build/mozconfig.common`, `browser/config/mozconfigs/macosx64-aarch64/profile-generate`). | `scripts/build-macos.sh`, `mozconfigs/macos-a18` | Medium: PGO for Rust code paths in style and rendering | Low; same flags Mozilla ships with. `VANTA_PGO=0` skips PGO entirely |
| 2 | **More processes shared per site.** With site isolation (Fission) nearly every page runs in a per-site process, so `dom.ipc.processCount=4` barely matters. The real cap is `dom.ipc.processCount.webIsolated` (4 per site on desktop). Set to 1, like Firefox on Android. | `prefs/vanta.js` | High RAM saving with several tabs of one site (each process is ~30-80 MB) | Low: tabs of the same site share one main thread, so one heavy tab can slow its siblings |
| 3 | **PHC off.** The probabilistic heap checker samples allocations to put memory-bug reports into crash reports. Its default turns on for machines with 8 GB+ (`memory.phc.min_ram_mb=8000`), which includes the MacBook Neo. With no crash reporter it is pure overhead. | `--disable-phc` in mozconfig and flake, `memory.phc.enabled=false` | Small RAM and CPU per process | None for users |
| 4 | **Image cache cap.** The decoded-image cache may grow to 1/4 of RAM (2 GB on 8 GB). Capped at 512 MB. | `image.mem.surfacecache.max_size_kb` | Medium on image-heavy pages, worst-case RAM | Low: images past the cap get decoded again |
| 5 | **No request pacing.** Firefox spreads out requests on busy pages; off sends them at once. | `network.http.pacing.requests.enabled=false` | Small, faster loads on resource-heavy pages | Low |
| 6 | **No initial paint delay.** | `nglayout.initialpaint.delay(_in_oopif)=0` | Tiny, first paint 5 ms sooner | None |
| 7 | **No page-interaction recording** into history. | `browser.places.interactions.enabled=false` | Tiny, less disk I/O | None |
| 8 | **Linker choice.** Pinned to lld (what mach picks anyway). `VANTA_LINKER=ld64` switches to Xcode's ld64, which Mozilla uses for shipped macOS PGO+LTO builds because lld measured slower; try it after a first build works. | `mozconfigs/macos-a18` | Small (Mozilla saw a regression with lld) | Medium for ld64: Xcode's linker with Mozilla's clang is untested here |
| 9 | **Isolate only high-value sites** (Fredrik's call, 2026-10-12). `fission.webContentIsolationStrategy=2` keeps a separate process for sites you are logged in to, have a saved password for, or that send a COOP header (30 days each); the rest share processes. `fission.highValue.login.monitor=true` turns on login detection, which desktop Firefox leaves off. | `prefs/vanta.js` | High RAM saving with many tabs: the biggest lever left | Weaker Spectre-style isolation between sites you are not logged in to |
| 10 | **Spring-based smooth scrolling.** `general.smoothScroll.msdPhysics.enabled=true`, Firefox Nightly's default: wheel and keyboard scrolls ease out like Safari's instead of stopping abruptly. Added after Fredrik found scrolling felt worse than Safari (2026-10-14); process sharing was ruled out first. | `prefs/vanta.js` | Smoother-feeling scrolling, no speed cost | Low: Mozilla's own default on Nightly |

Cleanups found on the way: `-O3` is already Firefox's default on macOS and for
PGO builds on Linux, so `--enable-optimize=-O3` was a no-op and is gone.
`dom.ipc.processPrelaunch.fission.number` is already 1 by default, so that line
is gone too.

## Already in place before this pass

Thin cross-language LTO on macOS (what Mozilla ships there), full
cross-language LTO and cross-language PGO in nixpkgs' builder on NixOS,
`-mcpu=apple-a18` / `x86-64-v3`, Rust SIMD, mozjemalloc (Firefox's own
allocator, with lazy purging on by default), and the memory and network prefs
in `prefs/vanta.js`.

## Needs a decision

| Lever | Gain | Cost |
|---|---|---|
| `--disable-eme`: drop Widevine DRM | No download of the ~20 MB CDM, no media plugin process | Netflix, Spotify web, Disney+ stop working |
| `accessibility.force_disabled=1` | Avoids big slowdowns when another app (window managers, password managers, Grammarly) turns on Firefox's accessibility engine | VoiceOver and those apps can't read the browser |

## Worth measuring once there is a build

- `RUSTC_OPT_LEVEL=3` (Mozilla uses 2): maybe a little faster Rust, bigger binary.
- Full instead of thin LTO on macOS: slightly faster, but the libxul link needs far more RAM than an 8 GB Mac has.
- PGO extended training corpus (`profileserver.py --extended-corpus`): better profiles, needs Mozilla's corpus download.
- `gfx.webrender.precache-shaders=true`: smoother first use of effects, slower first start.
- `reader.parse-on-load.enabled=false`: skips the reader-mode check on every page, but hides the reader view button.

## Not worth it

- Source patches: nothing found that prefs and build flags can't reach. Patching waits for profiles that show a hotspot.
- Turning off sandboxing, hardening, wasm library sandboxing or allocator poisoning: tiny speed for a real security loss.
- `--disable-webspeech`, `--disable-necko-wifi`, `--disable-parental-controls`: code that only runs when used, so no runtime gain.
- `--enable-jit-avx`: already on by default on x86-64.
- A different allocator: mozjemalloc is tuned for Gecko and has `about:memory` reporting.
