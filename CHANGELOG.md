# Changelog

All notable changes to Orrery. Versions follow [semantic versioning](https://semver.org): while Orrery is pre-1.0, a minor bump (0.**x**.0) can add features or change settings, and a patch bump (0.x.**y**) only fixes things.

## [0.3.0] - 2026-11-11

### Added
- **Other servers as planets.** Machines that aren't the Proxmox host become planets beyond the orrery, with the services they run as moons. Orrery suggests them from the router's client list and Tailscale peers, fingerprints each one with the service templates, and you switch them on under Setup → Other servers (or add one by address). Types: Media server, NAS, Desktop / PC, Home hub, Server.
- Tether colour shows the link: purple over Tailscale, blue on the local network, red when unreachable. This now applies to the media planet too.
- Service moons around the media planet (e.g. Plex, qBittorrent), inside the ring of stream moons.
- Plex running in a Proxmox guest is drawn as that guest instead of a separate planet; its streams show on the guest's card.
- Optional host agent `deploy/host/orrery-tailscale` that writes Tailscale peers for suggestions.

### Changed
- Setup's "Media world" switch is now the Other servers card. An existing off-host Plex is carried over as a Media server planet automatically.

## [0.2.0] - 2026-11-11

### Added
- Version number shown on the Setup screen and in the service log; `VERSION` file and this changelog.
- Optional settings in `data/config.json`: `media.ip` (the media-server PC, so remote-desktop sessions point at the giant) and `links.wiki` (makes recent wiki edits clickable).
- GitHub Releases are published automatically from this changelog when a version tag is pushed.
- `tools/leakcheck.py` and a pre-push hook (`tools/install-hooks.sh`) that stop private names, addresses and keys from being pushed. Changed screenshots are OCR'd when tesseract is installed.

### Fixed
- The purple Tailscale line to the media giant no longer shows when there's no Plex, or when Plex is reached on the local network rather than over a tailnet. Broadcast labels no longer assume Tailscale.
- Setup: the Connections legend no longer floats over the list of services.
- The LAN address map no longer picks up IPv6 addresses.
- `tools/install-hooks.sh` works in git worktrees, and the pre-push check skips tag pushes.

## [0.1.0] - 2026-11-08

First public release: automatic discovery with 46 service templates, the first-run setup wizard, the Setup screen, Orbit, Pulse, Vaults, Chronicle, Manifest, Broadcast and Network views.

[0.3.0]: https://github.com/prognar/Orrery/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/prognar/Orrery/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/prognar/Orrery/releases/tag/v0.1.0
