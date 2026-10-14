# Experimental patches

Nothing in this folder ships unless a build names it in `VANTA_EXPERIMENTAL`
(see `docs/building.md`), e.g. `VANTA_EXPERIMENTAL="frame-readback"`. A
patch's prefs go in a `.js` file with the same name.

- `0001-frame-readback.patch`: fixes trackpad scroll stutter on the MacBook
  Neo (A18 Pro). Scrolling is smooth only while the Firefox profiler grabs
  per-frame screenshots. This patch runs that downscale and readback without
  the profiler, behind `gfx.vanta.frame-readback` (0 off, 1 readback,
  2 also JPEG-encode; pref default 0; `0001-frame-readback.js` sets 1). It moves into
  `patches/` once Fredrik confirms it fixes scrolling.
