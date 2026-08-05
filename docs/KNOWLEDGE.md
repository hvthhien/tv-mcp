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

## Lab LG panels seen 2026-08-04 (reachability only)
- **50UR762H3ZC** — Pro:Centric, IP off-subnet / unreachable so far. RMS port 10000 doc observed (see RMS section).
- **24LV761H, webOS 3.6** @ 192.168.32.144 — 2017 Pro:Centric hotel panel.
  ARP resolves (LG MAC 38:8c:50:...), so L2-reachable, but ALL ports closed
  (10000/9922/9998/3000/3001) → neither RMS nor Dev Mode enabled yet.
  **⚠ Chromium 38 (webOS 3.x)**: legacy CDP protocol dialect. Our CdpBridge
  (chrome-remote-interface) targets modern CDP — screenshot/console/eval may
  need a legacy fallback (older firmware uses `/pagelist.json` +
  `inspectorUrl` instead of `/json/list` + `webSocketDebuggerUrl`; LG advises
  Chrome v38 devtools frontend for webOS ≤4.x). Expect the debug plane to
  need work on this panel even once Dev Mode is on. Deploy path (ares
  install/launch) should still work.
  Also: hotel panels often lack the LG Content Store → the Developer Mode
  app may not be installable here at all; RMS (port 10000) is the more
  likely door on Pro:Centric.

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
- Tool: `assert_playback` (tier 2) — **hardware-validated on HG32F800
  (Tizen 9, 2026-08-04)**: playing (25 frames decoded over 0.8s), paused,
  and resume-to-playing all judged correctly; screenshot evidence captured.
  Also confirms Tizen 9 webview supports canvas.captureStream and
  getVideoPlaybackQuality. Non-DRM video renders in CDP screenshots
  (DRM/hardware-plane content will not — metrics remain ground truth).

## Hospitality ecosystem research

> Four research reports pending (HCAP API surface, Pro:Centric platform,
> Samsung LYNK/HTV/b2bapis, webOS internals incl. Chromium-per-version CDP
> map and Dev Mode renewal mechanics). Findings land here graded
> CONFIRMED / REPORTED / UNKNOWN with source URLs.

### LG Pro:Centric platform (researched 2026-08-04)

**Family** (CONFIRMED, lgcommercialdisplay.com + solutions.lg.com):
- **Pro:Centric Smart** — webOS hotel TV tier; the one third-party SI apps target via HCAP.
- **Pro:Centric Direct (PCD)** — LG's on-prem CMS: dedicated in-house server, drag-drop HTML5 UI editor, PMS integration (auto-logout at checkout), delivery over property IP **or RF**.
- **Pro:Centric V** — RF/coax-only tier; B-LAN management channel over coax; low-tier panels (US342H).
- **Pro:Centric Cloud** — cloud CMS, webOS hotel TVs only, multi-property, no on-site server.
- **Pro:Centric+** — announced HITEC June 2025: vetted third-party services run natively on the TV (energy mgmt, client-side ad insertion, casting, asset tracking), wireless provisioning, **backward compatible to webOS 5.0** — note the ad-insertion angle overlaps our VOD/ads verification use case.

**App model** (CONFIRMED):
- Apps = plain **HTML5/JS**, no mandated framework. Official APIs: **HCAP for JavaScript** (hospitality device control) + **IDCAP** (unified webOS Signage + commercial TV API). Portal: procentric.developer.lge.com.
- Fleet delivery: **PCS500R server** (RF up to 8 QAM-B channels 54–865MHz, or GbE IP); remotely edits FTG channel maps + installer-menu config.
- TV-side: installer menu (Menu-lock + `9876`), items **098 PRO:CENTRIC** / **119 DATA CHANNEL**; set Mode: HTML, Media Type: IP, server domain+port → **TV fetches the HTML app from that web server on boot**. Fleet cloning via `.tlx` file on USB; first boot = EZ-Manager Wizard.
- HCAP limitations vs signage SCAP (integrator-CONFIRMED, engagephd.com): **no onboard app storage** (app cached, re-pulled after power cycle), no on/off scheduling, no remote screenshots via CMS.

**Developer access** (CONFIRMED): SDK/docs/firmware "exclusively to selected partners" — contact LG regional sales engineer → **NDA/DLA contract** → portal registration. LG staff redirect all HCAP questions away from the consumer forum. Cost: UNKNOWN.

**Relationship to consumer webOS** (CONFIRMED where noted):
- 2020–23 fleet (US670H, US770H, UR770H, STB-6500) = **webOS 5**; current UM670H/"UM777H" = **webOS 23** + Pro:Centric Direct + **Pro:Idiom DRM** + USB cloning. webOS 24 hotel panels: UNKNOWN.
- No LG Content Store on hotel panels; OTT = fixed embedded set. **Dev Mode app / ares on hospitality models: officially UNKNOWN** — de facto app-loading path is the Pro:Centric server / installer-menu HTML mode, not ares (consistent across all integrator docs).

**Ecosystem**: Nonius TV+ (Cast-certified on LG hospitality, Jan 2026), Nevron (middleware runs as the Pro:Centric HTML app), Otrum, EngagePHD, Ping HD — all use the same pattern: their cloud CMS serves the HTML app the TV pulls.

**Current lineup**: UM670H/UM777H (webOS 23), AM960H (OLED, 2025), UK660H/UK762H (2026, Cast+AirPlay native), UR770H/US770H/US670H (webOS 5), US342H (Pro:Centric V).

**tv-mcp implications**:
1. The dev loop on hotel LG panels ≠ ares. It's "point installer menu at a web server" — which means a tv-mcp `serve` capability (local dev server + TV pointed at it) may beat package/install entirely on Pro:Centric panels: edit → reload, no .ipk at all.
2. Remote debugging on hotel panels unverified — test on the incoming LG TV whether inspector access exists in HTML mode.
3. HCAP "no storage / re-pull after power cycle" = the fleet is effectively thin-client; server-side is where the app lives → our CDP/eval verification story still applies if inspector reachable.
4. webOS 5 is the floor for fleet compatibility (Pro:Centric+ compat statement).

### LG RMS REST API (port 10000) — observed on 50UR762H3ZC, 2026-08-04

**A Dev-Mode-free control path on hotel LG panels.** Observed directly from
the TV's own interactive API doc (`http://<tv-ip>:10000/doc/index.html`) —
primary source, grade [OBSERVED].

- RMS = Remote Management System; the external REST face of HCAP's `hcap.rms`.
- **No Dev Mode / no ares / no LG dev account** — plain HTTP on port 10000.
- Older models may not expose it. Requires the TV to have RMS enabled +
  the requestor authorized (IP allowlist).
- **Auth handshake**: `GET /api/authorize?deviceIpAddress=<TV>&requestorIpAddress=<this machine>`
  → grants the requestor IP access to the device's internal HCAP API.
- Doc UI at `/doc/index.html` (likely Swagger/OpenAPI — confirm on reachable TV).
- Remaining surface to capture from the doc: power, channel, volume, input,
  app control, device info, and CRITICALLY media/playback status (a
  DOM-free "what's playing / is it playing" path for VOD/ad verification).
- Not reachable in lab yet (TV off-subnet / powered down); scaffolded a
  client in `src/rms/client.ts` against the observed shape, untested.

**Research corroboration (2026-08-04)**: RMS spec is gated behind LG's
partner-only Pro:Centric portal — NOT publicly documented anywhere, no
open-source client/Postman exists. Public nmap data confirms port 10000
open on LG commercial webOS panels (alongside 3000/3001/9998). `hcap.rms` /
`requestRms` is the in-app JS twin of this external REST path — same
subsystem, two front doors (JS for on-TV apps, REST for off-TV clients).
`/doc/index.html` may be Javadoc rather than Swagger (SDK-structure match) —
confirm on hardware. IDCAP (sibling API) is CONFIRMED to expose screenshot
capture + telemetry (panel temp, backlight hours, firmware, USB), so RMS
likely has device-info/screenshot; media/playback reporting UNKNOWN — the
#1 thing to test. This is a genuinely undocumented surface; what the user
reads off the panel's own doc is the authoritative source.

**Priority to capture from the live doc**: (1) media/playback/foreground-app
status — the DOM-free VOD/ad verification path; (2) does /api/authorize
return a token/session or is it pure IP-allowlist; (3) power/input/volume;
(4) device info; (5) is /doc Swagger (exportable) or static Javadoc.

### Samsung LYNK / HTV ecosystem (researched 2026-08-04)

**LYNK map** (CONFIRMED): **LYNK Cloud** = current SaaS platform (device mgmt, HTML5/JS content framework, Open API for ordering/booking modules — spec partner-gated, analytics; 3 license tiers; native on RU750+ panels, older via Catapult STB). **LYNK REACH 4.0** = legacy on-prem server (RF coax or IP), US IPG service expired Dec 2021, migrated to LYNK Cloud. **LYNK SINC** = absorbed into REACH. **LYNK DRM** = separate thing: hospitality content encryption (peer of Pro:Idiom).

**App model** (CONFIRMED, developer.samsung.com — public docs):
- **H.Browser deprecated since Tizen 6.5**; legacy apps used `b2bapis` (`$B2BAPIS/b2bapis/b2bapis.js`).
- Current: **Tizen Enterprise Platform (TEP)** "Smart Hospitality Display" (2022+, Tizen 6.5+), unified **`webapis`** namespace ($WEBAPIS). Mappings: `b2bapis.b2bcontrol.rebootDevice()` → `webapis.systemcontrol.rebootDevice()`, `b2bbroadcast.*` → `webapis.broadcast.*`, `getMACAddress()` → `webapis.network.getMac()`.
- 23 Product API modules for HTV incl. AVPlay, Broadcast (Partner privilege; tuning, forensic watermark — NOT channel-map management), RemotePower, SystemControl, ProductInfo.
- Channel maps / welcome screens / sound-bar / power-on = **Hotel Option + clone-file + LYNK config, not public JS APIs**.
- Since Tizen 6.5: no HTTP MPEG-TS streaming (no pause/seek on such streams).

**Fleet deployment** (CONFIRMED unless noted):
- **Hotel Option menu: MUTE → 1 → 1 → 9 → Enter** (power-on channel/volume/source, panel lock, welcome msg, channel edit).
- USB cloning: "Clone TV to USB / USB to TV" from Hotel Option.
- **TEP Custom App** (REPORTED): Hospitality menu option pointing TV at a hosted signed .wgt — the fleet path for custom UIs. Signage sibling: URL-launcher `sssp_config.xml` + .wgt on HTTP server.
- **Tizen Business Manager** (tbm.tizenenterprise.com): zero-touch enrollment, 2022+/Tizen 6.5+.

**Developer access**:
- HTV API docs public; LYNK Cloud Open API partner-gated. Old samsungdforum.com is dead.
- **Partner-level distributor cert appears self-service** (REPORTED, field-verified on Tizen 8 commercial display): Certificate Manager → Samsung profile → Partner privilege → register device DUID → Samsung account. No formal contract needed in that report. Public cert on B2B device = "error -3: invalid certificate chain" (matches our HG32 finding).
- Extra step (CONFIRMED, field report): Device Manager → right-click device → **"Permit to install apps"** pushes your cert — installs can fail without it even in dev mode.

**Dev mode on B2B panels**: same 12345 flow (CONFIRMED Tizen 8 commercial). BUT **`sdb shell` blocked on B2B Tizen 8 firmware** (`intershell_support:disabled`) — only install/run/debug. Nuance from our own HG32 (Tizen 9 hospitality): `sdb shell 0 <wascmd>` (vd_appinstall, debug, kill, getduid) all worked — the block applies to interactive shell, not the `0` wascmd channel. Some HG units firmware-locked into hospitality mode (REPORTED).

**SSSP relationship** (CONFIRMED): signage + hospitality share one platform/team; both moved b2bapis → webapis on TEP; **tooling transfers** (same Tizen Studio, partner cert, .wgt, sdb, TBM). Differences: deployment entry (TEP Custom App vs sssp_config.xml) and a few per-vertical modules. Signage gets UWE (Upgradeable Web Engine — modern Chromium on old panels); HTV availability UNKNOWN.

### webOS platform internals (researched 2026-08-04)

**Version → Chromium map** (CONFIRMED, webostv.developer.lge.com): webOS TV 26→Chromium 132, 25→120, 24→108, 23→94, 22→87, 6.x→79, 5.x→68, 4.x→53, 3.x→38. Engine fixed per model year (never bumped mid-generation). CDP: 22+ fully modern; 3.x–5.x legacy dialects — feature-detect. Hotel fleet floor is webOS 5 (Chromium 68).

**Remote debugging — the headline for tv-mcp** (CONFIRMED):
- Dev-mode inspector listens on **TV port 9998** directly (system apps 9999). `http://TV_IP:9998/json/list` works over plain HTTP — **CDP can connect straight to `ws://TV_IP:9998/devtools/page/<id>` without ares-inspect** (no wss requirement; that applies only to the SSAP :3000→:3001 channel). Simplifies WebOSDriver: drop the long-lived ares-inspect child process.
- `ares-inspect` internals: SSH-forwards 9998, polls `/pagelist.json` (older) then `/json/list` (newer), matches by app id.
- Apps must be packaged **`--no-minify`** and installed via dev mode (`/media/developer`) to be inspectable. Undocumented appinfo field `inspectable: true` (REPORTED) makes non-devmode apps inspectable.
- CDP `Page.captureScreenshot` captures web contents only — **video planes are composited outside Chromium** (DRM/video shows black in screenshots). Directly relevant to VOD verification: use playback metrics for video, screenshots for UI.

**Dev Mode** (CONFIRMED via webosbrew + LG forum):
- Sessions now **1000 hours** (not 50h — older info). EXTEND resets timer; at 0 you cannot extend (apps uninstalled, logged out). Auto-disables after 10 reboots without network.
- **One TV per developer account** — new login logs out the old TV. Matters for lab fleets: one LG dev account per panel.
- Headless renewal (REPORTED): `ares-extend-dev` command exists in LG's TV CLI; alternative endpoint `GET https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken=<token>` — token readable on TV (`/var/luna/preferences/devmode_enabled`). Prior art: webosbrew Dev Manager, Neur0toxine/lg-webos-devmode-timer-extender. → implemented as the `renew_dev_mode` tool (tier 1): reads the token via ares-shell/ares-pull, calls the reset endpoint; only works while timer > 0. Note: modern @webos-tools/cli does NOT ship ares-extend-dev — endpoint is the only headless path. Unvalidated on hardware.

**Transport map**: SSH :9922 (user `prisoner`, key via `ares-novacom --getkey` + Dev Mode passphrase, lands in `~/.ssh/<device>_webos`) for install/launch/files; CDP :9998 for debug/eval/screenshot; SSAP wss://:3001 (2020+; :3000 blocked on webOS 5+ — our fallback order should PREFER 3001) for pairing-based control.

**appinfo.json**: required id (reverse-DNS, must not start com.palm/com.webos/com.lge), title, type (**only "web" for third parties**), main, icon 80×80, version X.Y.Z. Useful: resolution ("1920x1080"|"1280x720"), handlesRelaunch (webOSRelaunch event), disableBackHistoryAPI (app receives back key), requiredMemory, splashBackground 1920×1080.

**Luna vs SSAP**: `luna://` services callable only from code ON the TV via webOS.service.request (Audio, App Manager, Connection, db8, Settings, TV Device Info, Magic Remote...). `ssap://` = external WebSocket control protocol. luna-send on device restricted for `prisoner` user (root/homebrew only).

**Simulator** (CONFIRMED): per-version Simulators (webOS TV 22–25; macOS arm64 from 25) replaced the VirtualBox emulator. Same-version Chromium + webOSTV.js + Luna subset; run app from source dir via `ares-launch -s <version>` — no ipk needed. No DRM, no real video pipeline, no Dev Mode/SSH; headless undocumented.

### LG HCAP API surface (researched 2026-08-04)

HCAP = **Hospitality Common Application Platform** (not "Hotel Configuration
Application Protocol"). Findings graded [C]onfirmed (LG-authored artifacts,
incl. genuine `hcap.js` v1.24.6.5901 found in public GitHub repos) /
[R]eported / [U]nknown.

**Architecture** [C]: app (HTML5) → HCAP library → Pro:Centric middleware →
webOS. `hcap.js` is a thin JSON-RPC client over a **local WebSocket:
`ws://127.0.0.1:8053/hcap_command`** (wss://:8054 with `extHcapSecure=true`).
Async notifications = DOM events on `document` (`channel_changed`,
`media_event_received`, `debug_event_received`...). Every method takes one
options object with onSuccess/onFailure.

**API surface** [C, from source]: ~30 namespaces, 221 methods. Highlights:
- `hcap.mode.setHcapMode(HCAP_MODE_0..4)` — first call at app boot, gates capabilities; mode semantics [U].
- `hcap.property` — get/setProperty (string keys: `room_number`, `platform_version`, `hcap_middleware_version`...), get/set**InstallerMenuItem** with ~90 numbered items (STRT_CHANNEL:4, PROCENTRIC:98, DATA_CHANNEL:119, FACT_DEFAULT:117) — **entire hotel installer menu programmatically read/writable**.
- `hcap.channel` — full tuning (RF/IP incl. ATSC3, UDP/RTP), channel map, program info, signal status.
- `hcap.Media` — class-style player: play/pause/position/speed/audio-lang/subtitles. (VOD verification hook on hotel panels where video may bypass the DOM `<video>` element.)
- `hcap.system` — **requestScreenCaptureImage/getScreenCaptureImage** (screenshot without CDP!), getCpuUsage/getMemoryUsage, get/set**BrowserDebugMode** (inspector toggle, args [U]), showToastMessage, requestCloning, get/setProcentricServer.
- `hcap.key` — remote takeover: addKeyItem/sendKey, ~120 IR codes (POWER:409, VOL_UP:447...).
- `hcap.application` — launch/install/removeApplications, getServiceXml, RegisterSIApplicationList (.ipk SI apps exist alongside URL-launched HCAP-h apps).
- Also: power (reboot, WARM mode), volume, video mute/size, externalinput, network (VLAN, SoftAP, blocked ports, wifi diagnostics), rs232c, socket (UDP/TCP daemons), mpi (PMS interface), checkout (guest checkout snapshot), beacon/bluetooth/iot/webrtc (in-room calling), drm.securemedia.

**Deployment** [C]: NO .ipk for the main app — plain web app + `<script src=".../hcap.js">`; declared in **XAIT** (`xait.xml`) served by the Pro:Centric IP server (`type: Hcap-h`, AUTOSTART, HcapDescriptor url → index.html). TV-side entry [R]: hold SETTINGS until banner → `1-1-0-5`+OK (or `9876` → `119`/`253`) → Mode: HTML, Media Type: IP, server domain:80 → TV downloads app + reboots. Cloning via .TLL on USB. App flash limit <40MB; 1920×1080 canvas.

**Versioning** [C]: HCAP versions independent of webOS (1.19.0→1.24.6 known stream; 2018-vintage source). Read live: `getProperty('hcap_middleware_version')` + `('platform_version')`. Direction: LG merging toward **IDCAP** (unified signage+commercial API); remote FW only on IDCAP panels.

**Access** [C]: portal "Restricted Access: Partner Exclusive" — LG sales engineer → NDA/DLA → portal. No public HCAP reference; no HCAP emulator evidenced. Desktop trick [C]: hcap.js detects desktop UA and fails calls cleanly ("HCAP WebSocket is not available") → UI develops in Chrome; and a **mock server at ws://127.0.0.1:8053/hcap_command** can emulate the device — a viable tv-mcp test harness.

**Debugging on hotel panels**: `setBrowserDebugMode` exists [C] but args [U]; whether port 9998 inspector is open on Pro:Centric firmware [U] — test on real hotel panel. HCAP's own screen capture + CPU/mem APIs partially substitute.

**Hands-on artifacts**: github.com/okhfree/fourseasons (genuine hcap.js + working app), github.com/nfillon/LG-etereo-publicidad (full server layout: xait.xml, LGService.xml, .tlx, .ipk), github.com/mantranit/hoteza (production LG driver: channel maps, key takeover). Note: hcap.js is LG-proprietary, republished unofficially; current partner SDK will be newer.
