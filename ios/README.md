# Vanta for iOS

Apple only lets browsers use their own engine for users in the EU, so Vanta
can't ship Gecko on an iPhone in Norway. Vanta for iOS is therefore
Mozilla's **Firefox for iOS** (the `mozilla-mobile/firefox-ios` release in
`FIREFOX_IOS_VERSION`, MPL-2.0) with Vanta's patches on top, the same way
desktop Vanta is Firefox plus patches. It renders with Apple's WebKit.

What the patches change:

| Patch | Change |
|---|---|
| `0001-true-black-dark-default` | Dark theme is true black with near-black surfaces and a mono accent; dark is the default instead of following the system. |
| `0002-vanta-defaults` | First launch: no usage data, crash reports or studies sent to Mozilla; ad blocking on; no sponsored or trending suggestions; no Firefox onboarding or Mozilla Terms of Use prompt; DuckDuckGo is the default search engine. |
| `0003-vanta-new-tab` | The new tab from desktop Vanta: date and tonight's moon over a large search line, above a planet's horizon lit by the sun for the time of day; one sunrise on arrival, none with Reduce Motion. Tapping it opens the address bar. |
| `0004-vanta-name` | The app is called Vanta. |

The icon is `branding/src/ios.svg` rendered to `ios/branding/AppIcon.png`
(full-bleed; iOS rounds the corners).

## Build (Mac, iOS Simulator)

```sh
scripts/ios/prepare.sh     # ~/vanta-ios/firefox-ios: the pinned tag + Vanta
scripts/ios/build-sim.sh   # builds, installs in one simulator, screenshots in ~/vanta-ios/screenshots
```

`prepare.sh` resets its work dir to the pinned tag every run. `build-sim.sh`
keeps build products inside the work dir and compiles with 3 jobs so an
8 GB Mac doesn't swap. Removing `~/vanta-ios` removes everything.

Installing on an iPhone needs an Apple developer team and its own bundle ID;
that is not set up yet.
