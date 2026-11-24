# Changelog

All notable changes to Orrery. Versions follow [semantic versioning](https://semver.org): while Orrery is pre-1.0, a minor bump (0.**x**.0) can add features or change settings, and a patch bump (0.x.**y**) only fixes things.

## [0.4.0] - 2026-11-24

### Added
- **Planet presets.** Every other server gets a preset that decides how its planet looks and what's checked. All of them share the same green / amber / red, Eden to Hellscape language; each adds the thing you'd want to know about that kind of machine:

  | Preset | Looks like | Checks |
  |---|---|---|
  | Desktop / gaming PC, Laptop | a living world | temperatures, memory, drives, fans. Asleep (grey) when off, not an alarm |
  | Server / Pi | a smaller living world | the same, and red when it stops answering |
  | Media server | the ringed world | streams, library, services |
  | NAS / storage | banded world, a ring per pool filled as the pool fills | pool health and fill, TrueNAS alerts (or drive fill from an agent) |
  | Backup server | an ice world that melts as the last good backup gets old | age of each group's last backup, datastore fill, failed tasks (Proxmox Backup Server) |
  | Router / firewall | a beacon with traffic orbiting it | is the internet up, latency and loss, the router's DNS |
  | DNS / ad-blocker | an obsidian world with an accretion disc | does it answer DNS, is blocking on, how much is blocked (Pi-hole v5/v6, AdGuard Home) |
  | Home hub | city lights; dead devices are dark districts | devices unavailable, low batteries, updates (Home Assistant) |
  | Cameras / NVR | an eye per camera | cameras online, detector speed, recordings disk (Frigate) |
  | Game server | a moon per player | players online (Minecraft, any Steam query game) |
  | AI / GPU box | a forge whose veins glow with GPU load | loaded models (Ollama), GPU from an agent |
  | 3D printer | a ring being printed | state, progress, time left, errors (Klipper/Moonraker, OctoPrint) |

  Integrations that need no key (Frigate, Ollama, Moonraker, Minecraft) start on their own when the service is found; the rest are set up per server in Setup with a test button. Keys are kept in `secrets.json`, never in settings.
- **A side panel for every planet.** Click a planet (in 3D or 2D) for its status, what its preset reads, its services grouped (Streaming, Requests, Library automation, Downloads, Network, Home...), and the machine's health. The media planet's panel links to Broadcast.
- **The 2D map shows other servers** with their preset look, status colour, tether (purple Tailscale, blue LAN), label and hover card. The media planet's tether is blue when it's on the LAN.
- Orrery suggests a preset for each machine it finds, and recognises Synology, Unraid, OPNsense, pfSense, UniFi, OpenWrt, Blue Iris, Klipper, OctoPrint and Minecraft.

### Changed
- **Services are no longer drawn as moons.** They're listed in the planet's panel; a service that stops answering turns the planet amber. Clicking a service in Setup now stops (or resumes) watching it.
- Planets sit round the far side of the orrery instead of fanning towards the camera.
- A machine that's off isn't polled for health until it answers again.

## [0.3.0] - 2026-11-19

### Added
- **Other servers as planets.** Machines that aren't the Proxmox host become planets beyond the orrery, with the services they run as moons. Orrery suggests them from the router's client list and Tailscale peers, fingerprints each one with the service templates, and you switch them on under Setup → Other servers (or add one by address). Types: Media server, NAS, Desktop / PC, Home hub, Server.
- Tether colour shows the link: purple over Tailscale, blue on the local network, red when unreachable. This now applies to the media planet too.
- Service moons around the media planet (e.g. Plex, qBittorrent), inside the ring of stream moons.
- Plex running in a Proxmox guest is drawn as that guest instead of a separate planet; its streams show on the guest's card.
- Optional host agent `deploy/host/orrery-tailscale` that writes Tailscale peers for suggestions.
- Each server's services can be switched on or off as moons (click the chips in Setup → Other servers).
- **Living planets: Eden to Hellscape.** Every other server is a world on a green / yellow / red scale. The **land and sea are its climate**, the slow things (drives filling up and wearing out): lush green, then drought, then scorched earth with lava. The **sky and clouds are its weather**, the fast things (CPU and GPU temperature, memory, fans): clear blue, then amber haze and dust, then a burning red sky with smoke and embers. Cloud speed is how busy it is. Each reading is rated against thresholds and the label names the reason ("⚠ drive 89% full"); the hover card lists the readings that matter.
- Health from whichever agent the machine runs: LibreHardwareMonitor (Windows), Glances (Linux/macOS/Pi) or Netdata (directly or via a parent). LibreHardwareMonitor in Fahrenheit is converted; the discrete GPU is preferred over an iGPU.

### Changed
- Setup's "Media world" switch is now the Other servers card. An existing off-host Plex is carried over as a Media server planet automatically.

## [0.2.1] - 2026-11-19
- **Runs in Docker.** `ghcr.io/prognar/orrery` (amd64 and arm64) plus a `docker-compose.yml`. Configure it with `ORRERY_PVE_URL` and `ORRERY_PVE_TOKEN`; settings live in the `/data` volume.
- The Proxmox node is found automatically; `node` / `ORRERY_PVE_NODE` is only needed to pick one in a cluster.
### Fixed
- Clear messages instead of a crash when the Proxmox address or token is missing, or the data folder isn't writable.
- Stops promptly when asked to (`docker stop`, `systemctl stop`).

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

[0.4.0]: https://github.com/prognar/Orrery/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/prognar/Orrery/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/prognar/Orrery/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/prognar/Orrery/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/prognar/Orrery/releases/tag/v0.1.0
