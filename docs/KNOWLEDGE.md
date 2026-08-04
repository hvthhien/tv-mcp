# Platform knowledge base

Facts about the platforms tv-mcp targets. Everything here is either validated
on hardware (marked with the device) or graded CONFIRMED / REPORTED / UNKNOWN
by source quality. Update this file whenever hardware or research teaches
something new.

## Samsung Tizen — validated on HG32F800FNFXZA (hospitality, Tizen 9.0)

### Connectivity
- Dev connect: `sdb connect <ip>:26101`. Port only listens while dev mode is
  armed AND only accepts the whitelisted Host PC IP.
- Dev mode: Apps → `12345` → ON → Host PC IP → **reboot required**.
- Multi-homed trap: Host PC IP must be this machine's address **on the TV's
  subnet**; wrong-subnet IP = TV silently drops everything (no ping, all
  ports closed) while ARP still resolves.
- DUID: `sdb shell 0 getduid` (HG32 example: KLCDMLZKHUQNU).

### Install/launch (firmware reality vs CLI docs)
- `tizen install` fails silently on TV firmware. Working path:
  `sdb push <wgt> /home/owner/share/tmp/sdk_tools/tmp/` then
  `sdb shell 0 vd_appinstall <appId> <remotePath>` — reports progress
  percentages and real failure reasons.
- Uninstall: `sdb shell 0 vd_appuninstall <appId>` (full app id worked on
  HG32; pkgId-only returned "was get app info failed").
- Kill: `sdb shell 0 kill <pkgId>` — package id only; full app id fails with
  "General error [-1]".
- Debug launch: `sdb shell 0 debug <appId>` → output `... successfully
  launched pid = N with debug 1 port: <PORT>`. Hangs forever if app already
  running (kill first). Then `sdb forward tcp:<local> tcp:<PORT>`, fetch
  `http://127.0.0.1:<local>/json`, take the `page` target's
  `webSocketDebuggerUrl`.

### Signing
- Real panels reject the generic SDK distributor cert
  (`tizen-distributor-signer*.p12` from certificate-generator). Only
  Samsung-issued certs (living under `~/SamsungCertificate/<profile>/`)
  install; they embed device DUIDs.
- Install failure signature: `install failed[118, -12], reason: Check
  certificate error : :Invalid certificate chain...`
- Profiles registry: path printed by `tizen security-profiles list`
  ("Loaded in '<path>'"), XML with per-profile author/distributor key paths.

### Hospitality (HG-series) specifics
- IP-remote service (ports 8001/8002, Samsung remote WS API) is **disabled**
  on hotel firmware → `remote_key` pairing impossible; use eval_js synthetic
  KeyboardEvents (LEFT 37, UP 38, RIGHT 39, DOWN 40, ENTER 13, BACK 10009).
- Everything else in the dev loop (vd_appinstall, debug, CDP) works the same
  as consumer on Tizen 9 hotel firmware.

## LG webOS — NOT yet hardware-validated

Driver implemented against ares-* CLI docs; expect a firmware-drift round
like Tizen had. Planned validation when lab LG panel arrives.

- Registration: `ares-setup-device` (ssh port 9922, user `prisoner`),
  key exchange `ares-novacom --getkey` with Dev Mode passphrase.
- Dev Mode sessions expire ~50h; installs then fail with connection errors.
- Debug: `ares-inspect --device <d> --app <id>` prints a localhost proxy URL;
  keep the process alive, resolve CDP ws from `<url>/json`.
- remote_key: SSAP register ws://:3000 / wss://:3001, client-key persisted,
  button events on the pointer-input socket. Untested on hardware.

## VOD / playback verification (primary Xcontrol use case)

Goal: assert that Video-On-Demand content or advertisements are actually
playing on the panel. All achievable over the existing CDP plane:

- Playing vs stalled: sample `video.currentTime` twice with a delay;
  advancing → playing.
- Quality: `video.getVideoPlaybackQuality()` → droppedVideoFrames,
  totalVideoFrames; `video.readyState`, `video.networkState`.
- Errors: `video.error` (MediaError code), `encrypted`/EME events for DRM.
- Black screen while audio plays: CDP screenshot + pixel variance check —
  metrics alone miss this class.
- Platform player errors: `device_logs` (dlog / ares-log).
- Candidate tool: `assert_playback` — one call returning
  playing | stalled | black-screen | error with evidence (timestamped
  screenshot = ad proof-of-play).

## Hospitality ecosystem research

> Four research reports pending (HCAP API surface, Pro:Centric platform,
> Samsung LYNK/HTV/b2bapis, webOS internals incl. Chromium-per-version CDP
> map and Dev Mode renewal mechanics). Findings land here graded
> CONFIRMED / REPORTED / UNKNOWN with source URLs.

### LG HCAP / Pro:Centric — pending
### Samsung LYNK / H-Browser / b2bapis — pending
### webOS version → Chromium map — pending
