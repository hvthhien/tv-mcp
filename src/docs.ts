/**
 * Deep documentation, exposed as MCP resources (tvmcp://docs/<topic>).
 *
 * Progressive disclosure: tool descriptions stay one-liners; the gnarly
 * platform knowledge lives here and is fetched only when the agent hits
 * the corresponding problem.
 */
export const DOCS: Record<string, { title: string; body: string }> = {
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

Both vendors need a one-time on-screen pairing; tv-mcp will persist tokens per device.

## Samsung (Tizen)
WebSocket: wss://<tv>:8002/api/v2/channels/samsung.remote.control?name=<b64 name>&token=<token>
First connect without token → TV shows an allow/deny prompt → response contains
a token to persist. Keys sent as {"method":"ms.remote.control","params":
{"Cmd":"Click","DataOfCmd":"KEY_ENTER",...}}.

## LG (webOS)
SSAP WebSocket: ws://<tv>:3000 (wss://<tv>:3001 on 2022+ firmware).
Register with a manifest → TV prompts → response contains client-key to persist.
Then request ssap://com.webos.service.networkinput/getPointerInputSocket and send
button events (type:button name:ENTER etc.) on the returned socket.

## Workaround available today
eval_js can dispatch synthetic KeyboardEvents, which most spatial-navigation
frameworks handle identically to real remote input.
`,
  },
};
