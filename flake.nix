{
  description = "homelable development environment";

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
            nodejs_22
            python313
            just
          ];
          shellHook = ''echo "dev shell ready — run just"'';
        };
      });

      checks = forAllSystems (pkgs: {
        fmt = pkgs.runCommand "fmt-check" { buildInputs = [ pkgs.nixfmt ]; } ''
          nixfmt --check ${self}/flake.nix
          touch $out
        '';
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
