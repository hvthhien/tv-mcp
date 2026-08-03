# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Planned: Android TV driver — adb platform plane + shared CDP debug plane ([#1](https://github.com/skdonthi/tv-mcp/issues/1))
- Planned: webOS Dev Mode session auto-renew
- Planned: Tizen emulator / webOS simulator targets
- Planned: streamable-HTTP transport with device locking for shared TV labs

## [0.2.3] - 2026-08-03

### Added

- `device-setup` docs topic: first-time TV setup checklist for both platforms —
  dev mode, host PC IP, network requirements, vendor CLI installation. Includes
  the multi-homed-machine trap: the Host PC IP on a Samsung TV must be this
  machine's address on the TV's subnet, or the TV silently drops everything.
- README Prerequisites section covering machine-side toolchains, one-time TV
  configuration, signing requirements, and network expectations per platform.

### Changed

- Tizen connect errors now point at the `device-setup` docs topic and call out
  the subnet requirement for Host PC IP.

## [0.2.2] - 2026-08-03

First release validated against real hardware (Samsung HG32F800 hospitality panel, Tizen 9).

### Changed

- Tizen installs now use `sdb push` + `vd_appinstall` instead of the `tizen install`
  CLI, which fails silently on TV firmware. Real failure reasons (e.g. certificate
  chain errors) now surface with remediation guidance.

### Fixed

- Tizen debug launch is idempotent: a running app instance is killed first
  (`shell 0 debug` hangs on an already-running app), stale port forwards are
  cleared, and the launch times out after 30s with a remedy instead of hanging.
- App kill/stop now passes the package id to `pkgcmd` — the full app id was
  silently ignored, deadlocking relaunches.

### Documented

- Samsung HG-series (hospitality) firmware disables the consumer IP-remote
  service on ports 8001/8002, so `remote_key` cannot pair on those panels.
  The `eval_js` synthetic-KeyboardEvent fallback is the verified alternative,
  now documented with key codes in the `remote-key-pairing` docs topic.

## [0.2.1] - 2026-08-03

Maintenance release validating the fully automated publish pipeline.

### Changed

- npm publishing moved to OIDC trusted publishing with provenance — no
  long-lived tokens (2FA-bypass granular access tokens are deprecated by npm).
- CI: `actions/checkout` v5, `actions/setup-node` v6, Node 24 for publishing.

### Fixed

- The npm publish step skips versions that already exist, so the MCP Registry
  step can run standalone.
- `server.json` description shortened to the MCP Registry's 100-character cap.

## [0.2.0] - 2026-08-03

### Added

- Remote-control key injection on both platforms via `remote_key`:
  - Samsung: remote WebSocket API on port 8002 with one-time on-screen pairing;
    granted token persisted per device.
  - LG: SSAP registration (wss 3001 / ws 3000 fallback) with client-key
    persistence; key presses over the pointer-input socket.
- Persistent token store at `~/.tv-mcp/state.json` (mode 0600) for pairing secrets.
- `server.json` manifest and publish workflow for the official MCP Registry
  (`io.github.skdonthi/tv-mcp`).

## [0.1.0] - 2026-08-03

### Added

- Initial release: MCP server for Samsung Tizen and LG webOS Smart TV development.
- Progressive tool disclosure in three tiers: 3 tools at session start
  (`list_devices`, `connect_device`, `docs`); app lifecycle tools unlock on
  device connect; inspector tools (`screenshot`, `console_logs`, `eval_js`)
  unlock on debug launch.
- Tizen driver (`tizen`/`sdb`): connect, package + sign with certificate
  profiles, install, debug launch with CDP websocket resolution.
- webOS driver (`ares-*`): device registration, packaging, install, launch,
  `ares-inspect` debug attach.
- Shared Chrome DevTools Protocol bridge: screenshots, console/exception
  capture, JS evaluation — identical on both platforms.
- Deep platform docs as on-demand MCP resources (Tizen signing/DUIDs, webOS
  dev mode, packaging, remote pairing).
- Structured errors (`TVMcpError`) with mandatory agent-actionable remedies.

[Unreleased]: https://github.com/skdonthi/tv-mcp/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/skdonthi/tv-mcp/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/skdonthi/tv-mcp/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/skdonthi/tv-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/skdonthi/tv-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/skdonthi/tv-mcp/releases/tag/v0.1.0
