{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = [
    pkgs.nodejs_22
    (pkgs.python313.withPackages (pythonPackages: [
      pythonPackages.pytest
      pythonPackages.skyfield
    ]))
  ];
}
