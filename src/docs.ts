/**
 * Deep documentation, exposed as MCP resources (tvmcp://docs/<topic>).
 *
 * Progressive disclosure: tool descriptions stay one-liners; the gnarly
 * platform knowledge lives here and is fetched only when the agent hits
 * the corresponding problem.
 */
export const DOCS: Record<string, { title: string; body: string }> = {
  "device-setup": {
    title: "First-time TV setup: dev mode, host IP, network — start here when connect fails",
    body: `# Device setup checklist

## Both platforms
- TV powered ON (not standby) and on the SAME SUBNET as this machine.
- Multi-homed machine (Wi-Fi + Ethernet, VPN, VLANs)? Identify which local IP
  sits on the TV's subnet — that is the address the TV must be told about.
  Wrong-subnet host IP = the TV silently drops everything (no ping, all ports
  closed) even though ARP resolves.

## Samsung (Tizen)
1. Apps panel -> type 1 2 3 4 5 on the remote -> Developer mode popup
2. Developer mode: ON
3. Host PC IP: this machine's IP on the TV's subnet
4. REBOOT the TV — dev mode only arms after a restart
5. Verify: sdb connect <tv-ip>:26101 then sdb devices
6. Port 26101 only listens while dev mode is armed and only accepts the
   whitelisted host.

## LG (webOS)
1. Install "Developer Mode" app from LG Content Store (LG developer account)
2. Open it, turn Dev Mode ON, note the passphrase on screen
3. devices.yaml: set passphraseEnv to an env var holding that passphrase
4. connect_device runs ares-setup-device + the key exchange
5. Sessions expire after ~50h — see tvmcp://docs/webos-dev-mode

## Vendor CLIs on this machine
- Tizen: Tizen Studio CLI; tizen + sdb on PATH
- webOS: npm i -g @webos-tools/cli; ares-* on PATH
tv-mcp shells out to these — install errors from missing CLIs name the fix.
`,
  },
  "tizen-signing": {
    title: "Tizen certificate profiles, DUIDs, and why installs get rejected",
    body: `# Tizen signing

Every .wgt is signed with a certificate profile = author certificate + distributor certificate.

## Privilege levels
- **public**: default, most web APIs
- **partner**: needed for hospitality/B2B APIs (e.g. b2bapis, network config).
  The distributor certificate must be issued by Samsung with the TARGET TV's
  DUID embedded. An app signed for TV-A will be REJECTED by TV-B unless
  TV-B's DUID is also in the certificate.

## Getting a DUID
Connect the TV (sdb connect <ip>:26101), then: sdb -s <serial> shell 0 getduid

## Symptoms → causes
- "signature invalid" on install → DUID missing from distributor cert, or cert expired
- app installs but privileged API returns SecurityError → profile is public, needs partner
- install works on emulator, fails on TV → emulator skips DUID checks

## Managing profiles
- List: tizen security-profiles list
- Profiles live in ~/tizen-studio-data/profile/profiles.xml
- Re-issue partner certs through Samsung Seller / partner portal with the full DUID list.
`,
  },
  "webos-dev-mode": {
    title: "webOS Developer Mode: 50-hour sessions, passphrases, key exchange",
    body: `# webOS Developer Mode

Installs on retail LG TVs go through the Developer Mode app (LG Content Store,
requires an LG developer account).

## Session expiry — the #1 "why won't it install"
Dev Mode sessions last 50 hours, then the TV silently drops SSH access.
ares-install then fails with a connection error that looks like a network problem.
Fix: open the Dev Mode app on the TV and re-enable (or extend the timer).
tv-mcp surfaces this in install errors; a renew_dev_mode tool is on the roadmap
(the Dev Mode app exposes a local endpoint the session token can be refreshed through).

## First-time device setup
1. Dev Mode app on TV: turn Dev Mode ON, note the passphrase on screen
2. devices.yaml: set passphraseEnv to an env var holding that passphrase
3. connect_device → runs ares-setup-device + ares-novacom --getkey

## Commercial/hospitality panels
LG commercial displays (Pro:Centric, WebOS Signage) use a different provisioning
path (IDCAP / SuperSign), not the consumer Dev Mode app. Driver support for
signage panels is a roadmap item — sponsorship welcome.
`,
  },
  "webos-packaging": {
    title: "webOS packaging: appinfo.json requirements",
    body: `# webOS packaging

ares-package needs the web build dir to contain appinfo.json:

{
  "id": "com.example.app",        // must match devices.yaml webos.appId
  "version": "1.0.0",
  "vendor": "You",
  "type": "web",
  "main": "index.html",
  "title": "App",
  "icon": "icon.png"              // 80x80 png must exist
}

Common failures:
- missing icon file referenced by "icon" → package error
- id mismatch between appinfo.json and launch calls → app "installs" but won't launch
`,
  },
  "remote-key-pairing": {
    title: "Remote-control key injection: pairing flows for both vendors",
    body: `# Remote key injection

Both vendors need a ONE-TIME on-screen pairing. The first remote_key call to a
device makes the TV show an approval prompt — accept it with the physical
remote within 60s. The granted secret (Samsung token / LG client-key) is
persisted to ~/.tv-mcp/state.json (mode 0600) and the prompt never reappears
unless the TV is factory-reset (then: delete the device's entry and re-pair).

## Samsung (Tizen)
WebSocket: wss://<tv>:8002/api/v2/channels/samsung.remote.control
- Port 8002 only listens while the TV is ON (not standby)
- Self-signed TLS; trust comes from the pairing prompt, not the cert chain
- Models before 2016 use a different protocol and are unsupported
- If no prompt appears: TV menu → General → External Device Manager →
  Device Connection Manager → check this machine is not blocked

## LG (webOS)
SSAP WebSocket: wss://<tv>:3001 with ws://<tv>:3000 fallback (older firmware).
Key presses go over a secondary pointer-input socket
(ssap://com.webos.service.networkinput/getPointerInputSocket).
Works on consumer TVs with or without Dev Mode — pairing is independent of the
Dev Mode app used for installs.

## Hospitality panels (Samsung HG series)
Hotel-mode firmware ships with the consumer IP-remote service (ports
8001/8002) DISABLED, so remote_key fails with EHOSTUNREACH on HG panels
(verified on HG32F800, Tizen 9). Use the eval_js fallback below — it works
because it rides the debug inspector, not the remote API.

## Fallback
eval_js can dispatch synthetic KeyboardEvents, which most spatial-navigation
frameworks handle identically to real remote input — useful on hospitality
panels and when the TV is in a rack with no one nearby to approve a
first-time pairing prompt:

  document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 39, which: 39, bubbles: true}))

Key codes: LEFT 37, UP 38, RIGHT 39, DOWN 40, ENTER 13, BACK 10009 (Tizen) / 461 (webOS).
`,
  },
};
