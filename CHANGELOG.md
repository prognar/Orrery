# Changelog

All notable changes to Orrery. Versions follow [semantic versioning](https://semver.org): while Orrery is pre-1.0, a minor bump (0.**x**.0) can add features or change settings, and a patch bump (0.x.**y**) only fixes things.

## [0.2.0] - 2026-11-11

### Added
- Version number shown on the Setup screen and in the service log; `VERSION` file and this changelog.
- Optional settings in `data/config.json`: `media.ip` (the media-server PC, so remote-desktop sessions point at the giant) and `links.wiki` (makes recent wiki edits clickable).
- `tools/leakcheck.py` and a pre-push hook (`tools/install-hooks.sh`) that stop private names, addresses and keys from being pushed. Changed screenshots are OCR'd when tesseract is installed.

### Fixed
- The purple Tailscale line to the media giant no longer shows when there's no Plex, or when Plex is reached on the local network rather than over a tailnet. Broadcast labels no longer assume Tailscale.
- Setup: the Connections legend no longer floats over the list of services.
- The LAN address map no longer picks up IPv6 addresses.

## [0.1.0] - 2026-11-08

First public release: automatic discovery with 46 service templates, the first-run setup wizard, the Setup screen, Orbit, Pulse, Vaults, Chronicle, Manifest, Broadcast and Network views.

[0.2.0]: https://github.com/prognar/Orrery/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/prognar/Orrery/releases/tag/v0.1.0
