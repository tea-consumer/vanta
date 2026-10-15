// swift-tools-version: 5.9
// Vanta: the ModifiedCopy library from github.com/WilhelmOks/ModifiedCopyMacro
// (d020bf8, MIT, see LICENSE) without its macro target. Xcode 27 builds that
// target for iOS instead of the Mac, so scripts/ios/prepare.sh builds the
// macro for the Mac with SwiftPM and the build loads it with
// -load-plugin-executable.
import PackageDescription

let package = Package(
    name: "ModifiedCopy",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "ModifiedCopy", targets: ["ModifiedCopy"]),
    ],
    targets: [
        .target(name: "ModifiedCopy"),
    ]
)
