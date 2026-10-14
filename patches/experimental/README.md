# Experimental patches

`scripts/apply-vanta.sh` only applies `patches/*.patch`, so nothing in this
folder ships. Test builds apply these by hand.

- `0001-frame-readback.patch`: fixes trackpad scroll stutter on the MacBook
  Neo (A18 Pro). Scrolling is smooth only while the Firefox profiler grabs
  per-frame screenshots. This patch runs that downscale and readback without
  the profiler, behind `gfx.vanta.frame-readback` (0 off, 1 readback,
  2 also JPEG-encode; pref default 0). Test builds also add
  `pref("gfx.vanta.frame-readback", 1);` to `prefs/vanta.js`. It moves into
  `patches/` once Fredrik confirms it fixes scrolling.
