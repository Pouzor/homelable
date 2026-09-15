{
  description = "Homelable development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            # CI currently tests Node 20; nixos-26.05 marks Node 20 insecure/EOL,
            # so use the compatible supported LTS locally.
            nodejs_22
            python311
            python313
            uv
            just
            nixfmt
            shellcheck
            hadolint
            stdenv.cc.cc.lib
          ];

          shellHook = ''
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ]}:$LD_LIBRARY_PATH"
            echo "Homelable dev shell ready — run \`just\`"
          '';
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
