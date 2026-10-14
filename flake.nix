{
  description = "Vanta: a fast, RAM-efficient browser built from Firefox source";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      version = builtins.replaceStrings [ "\n" ] [ "" ] (builtins.readFile ./FIREFOX_VERSION);

      vanta-unwrapped = (pkgs.buildMozillaMach {
        pname = "vanta";
        inherit version;
        binaryName = "vanta";
        applicationName = "Vanta";
        branding = "browser/branding/vanta";

        # Mozilla's own release source tarball. Update the hash when bumping
        # FIREFOX_VERSION (nix will print the right one on mismatch).
        src = pkgs.fetchurl {
          url = "mirror://mozilla/firefox/releases/${version}/source/firefox-${version}.source.tar.xz";
          sha512 = "14b8ffdc325a234061db14dea9bd144786dc2c84468a5dfe2bb70bb9558f63f73427cf244eaf461010ee01dfdf04f2cae68bae9f07b4820603a4bcd4462f7960";
        };

        extraPostPatch = ''
          bash ${./.}/scripts/apply-vanta.sh .
        '';

        # Tune for x86-64-v3 (AVX2). Cross-language PGO and full cross-language
        # LTO are already on in nixpkgs' Firefox build on x86_64-linux, and PGO
        # builds already use -O3 there.
        extraPreConfigure = ''
          export NIX_CFLAGS_COMPILE="$NIX_CFLAGS_COMPILE -march=x86-64-v3"
          export RUSTFLAGS="''${RUSTFLAGS:-} -C target-cpu=x86-64-v3"
        '';
        extraConfigureFlags = [
          "--enable-rust-simd"
          # PHC samples allocations to catch memory bugs for crash reports;
          # with no crash reporter it only costs RAM and CPU.
          "--disable-phc"
        ];

        meta = {
          description = "Fast, RAM-efficient browser built from Firefox source";
          license = pkgs.lib.licenses.mpl20;
          platforms = [ "x86_64-linux" ];
          mainProgram = "vanta";
        };
      }).override {
        enableOfficialBranding = false;
        enableCrashReporter = false;
        enableDataReporting = false;
        enableDebugSymbols = false;
      };
    in {
      packages.${system} = {
        inherit vanta-unwrapped;
        vanta = pkgs.wrapFirefox vanta-unwrapped { };
        default = self.packages.${system}.vanta;
      };
    };
}
