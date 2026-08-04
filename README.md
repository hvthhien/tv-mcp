# tv-mcp

**Build, deploy, and debug Smart TV web apps from any AI agent.**

`tv-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives MCP clients (Claude Code, Cursor, VS Code, ...) hands-on access to real Samsung **Tizen** and LG **webOS** televisions: package and sign apps, install them on test TVs, take screenshots, read the JS console, evaluate code in the running app, and press remote-control keys.

The goal: an agent loop of *edit code → build → install → screenshot → read console → fix* that runs hands-free on physical TVs.

## Who this is for

Smart TV development has the worst inner loop in web development: two vendor SDKs, certificate ceremonies, dev-mode timers, and a screen on the other side of the room. This hits hardest in **hospitality and B2B TV** — hotel IPTV, cruise ships, hospitals, digital signage, sports bars — where teams ship one web app to fleets of mixed Samsung/LG panels.

If that's you, this project is for you.

## How it works

Your TV app is a web app in a native wrapper (`.wgt` / `.ipk`). Both platforms expose the webview's **Chrome DevTools Protocol** remote inspector. So `tv-mcp` splits into:

- a **platform plane** per vendor (build/sign/install/launch via `tizen`/`sdb` and `ares-*` CLIs), and
- a shared **CDP plane** (screenshot, console, JS eval) that works identically on both — because underneath it's just Chromium.

```
MCP client ── stdio ── tv-mcp
                         ├── TizenDriver  → tizen / sdb        → Samsung TV
                         ├── WebOSDriver  → ares-*             → LG TV
                         └── CdpBridge    → DevTools Protocol  → the app's webview (both)
```

## Progressive disclosure

A fresh session exposes only **3 tools** (`list_devices`, `connect_device`, `docs`). Connecting a device unlocks the app-lifecycle tier; launching with `debug: true` unlocks the inspector tier (`screenshot`, `console_logs`, `eval_js`). Deep platform knowledge (Tizen signing/DUIDs, webOS dev-mode expiry, pairing flows) ships as MCP resources fetched on demand — your agent's context stays small until it actually needs the detail.

| Tier | Unlocked by | Tools |
|---|---|---|
| 0 | always | `list_devices`, `connect_device`, `docs`, `doctor` |
| 1 | device connected | `build_app`, `install_app`, `launch_app`, `stop_app`, `uninstall_app`, `device_logs`, `remote_key` |
| 2 | debug launch | `screenshot`, `console_logs`, `eval_js` |

## Prerequisites

tv-mcp orchestrates the vendor toolchains — it does not replace them. You need:

| | Samsung (Tizen) | LG (webOS) |
|---|---|---|
| **On this machine** | Node ≥ 20 · [Tizen Studio CLI](https://developer.tizen.org/development/tizen-studio/download) (`tizen`, `sdb` on PATH) | Node ≥ 20 · webOS TV CLI: `npm i -g @webos-tools/cli` (`ares-*` on PATH) |
| **On the TV, once** | Developer mode: Apps → type `1 2 3 4 5` → ON → set **Host PC IP** to this machine's address **on the TV's subnet** → reboot the TV | Developer Mode app from LG Content Store (needs an LG developer account) → Dev Mode ON → note the on-screen passphrase |
| **Signing** | Certificate profile in Tizen Studio's certificate manager. Real TVs reject the generic Tizen distributor cert — you need a **Samsung-issued** cert that includes the TV's DUID (`sdb shell 0 getduid`) | none (dev installs ride the Dev Mode session) |
| **Network** | TV and this machine on the same subnet; port 26101 open only while dev mode is armed | same subnet; SSH on 9922 via the Dev Mode app; sessions expire after ~50h |

Common trap (learned on real hardware): a multi-homed machine has several IPs — the Host PC IP on the TV must be the one on the **TV's** subnet, or the TV silently drops every connection. `docs` topic `device-setup` has the full checklist; the server's errors point there when connect/install fails.

Not sure your setup is right? Ask the agent to run **`doctor`** — one pass over toolchains, signing profiles (it distinguishes Samsung-issued certs from the generic SDK cert that real TVs reject), and TV reachability, with a remedy for every failing item.

## Quick start

```bash
npm install
npm run build
cp devices.example.yaml devices.yaml   # edit for your TVs and project
```

Claude Code:

```bash
claude mcp add tv -- node /path/to/tv-mcp/dist/index.js --config /path/to/devices.yaml
```

Then, in a session:

> connect to lab-samsung-q80, build the xtv project for tizen, install and launch it in debug mode, and screenshot it

## Status

Early. Honest capability matrix:

| Capability | Tizen | webOS |
|---|---|---|
| discover / connect | ✅ | ✅ |
| package (+sign) | ✅ | ✅ |
| install / launch / stop | ✅ | ✅ |
| debug attach (CDP) | ✅ | ✅ |
| screenshot / console / eval | ✅ | ✅ |
| remote key injection | ✅ (one-time on-screen pairing) | ✅ (one-time on-screen pairing) |
| dev-mode auto-renew | n/a | 🚧 planned |
| emulator / simulator targets | 🚧 | 🚧 |
| commercial panels (Pro:Centric, SSSP) | 🚧 | 🚧 |

## Roadmap

- v0.2 — ✅ remote-key pairing (Samsung remote WS API, LG SSAP)
- v0.2.x — webOS dev-mode auto-renew
- v0.3 — Android TV driver ([#1](https://github.com/skdonthi/tv-mcp/issues/1)): adb platform plane + the same CDP debug plane (Android TV webapps are Chromium WebViews too)
- v0.3 — Tizen emulator + webOS simulator targets, CI-friendly headless mode
- v0.4 — streamable-HTTP transport + device locking: one shared TV lab, whole team's agents
- v1.0 — commercial hospitality panels (LG Pro:Centric / webOS Signage, Samsung SSSP / HTV)

## Sponsoring

Commercial-panel support (Pro:Centric, SSSP) needs hardware and vendor-portal access that individual maintainers don't have. If your company ships hospitality TV apps and wants this to exist, sponsorship or hardware loans move the roadmap directly — see [FUNDING](.github/FUNDING.yml) or open a discussion.

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The `TVDriver` interface in [src/types.ts](src/types.ts) is the extension point; a Vizio/Roku/Android TV driver would slot right in.

## License

[MIT](LICENSE)
