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
          sha512 = "c019202b2f87d25b3605bbf7266f3bb4d59745e48536f297d3f00cc3524a1cd2eba416a5a3cd0ecee6b0762d0f35bf3c5fcce286ebc7bc741263bebd0f102858";
        };

        extraPostPatch = ''
          bash ${./.}/scripts/apply-vanta.sh .
        '';

        # Tune for x86-64-v3 (AVX2). PGO and cross-language LTO are already
        # on by default in nixpkgs' Firefox build on x86_64-linux.
        extraPreConfigure = ''
          export NIX_CFLAGS_COMPILE="$NIX_CFLAGS_COMPILE -march=x86-64-v3"
          export RUSTFLAGS="''${RUSTFLAGS:-} -C target-cpu=x86-64-v3"
        '';
        extraConfigureFlags = [
          "--enable-optimize=-O3"
          "--enable-rust-simd"
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
