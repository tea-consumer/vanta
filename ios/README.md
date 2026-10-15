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
| `0005-xcode27-local-modifiedcopy` | Build fix for Xcode 27: Firefox's `ModifiedCopy` package comes from `ios/packages/` without its macro target, and `prepare.sh` builds the macro for the Mac with SwiftPM. |
| `0006-black-toolbar-glass` | In dark mode the toolbars drop the iOS 26 glass material, which lightens even a black tint, and are plain true black. |
| `0007-no-mozilla-surveys` | No Mozilla survey screens or survey prompts. |

The icon is `branding/src/ios.svg` rendered to `ios/branding/AppIcon.png`
(full-bleed; iOS rounds the corners).

## Build (Mac, iOS Simulator)

```sh
scripts/ios/prepare.sh     # ~/vanta-ios/firefox-ios: the pinned tag + Vanta
scripts/ios/build-sim.sh   # builds, installs in one simulator, screenshots in ~/vanta-ios/screenshots
```

`prepare.sh` resets its work dir to the pinned tag every run. `build-sim.sh`
keeps build products inside the work dir and compiles with 2 jobs so an
8 GB Mac doesn't swap. Removing `~/vanta-ios` removes everything.

Installing on an iPhone needs an Apple developer team and its own bundle ID;
that is not set up yet.
