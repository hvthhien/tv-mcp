# tv-mcp — agent context

MCP server for Smart TV app development: build/sign/install/launch/debug web
apps on Samsung Tizen and LG webOS panels. TypeScript, ESM, Node ≥ 20.

## Architecture rules

- **Two planes.** Platform plane per vendor (`src/drivers/*` behind the
  `TVDriver` interface in `src/types.ts`) for what genuinely differs;
  shared CDP plane (`src/cdp/bridge.ts`) for screenshot/console/eval —
  both TVs are Chromium underneath. Never duplicate into a driver what
  CDP can do once.
- **Progressive disclosure.** Tools live in tiers (see `src/server.ts`):
  tier 0 always visible, tier 1 enabled on device connect, tier 2 on debug
  launch. New tools must declare a tier. Tool descriptions stay one sentence;
  deep knowledge goes in `src/docs.ts` topics (served as MCP resources).
- **Errors are UI for agents.** Every throw is a `TVMcpError` with a `remedy`
  that names the next action. "Failed" without a remedy does not merge.
- **Real hardware wins.** When firmware behavior contradicts the vendor CLI
  docs, code to the firmware and record the finding in `docs/KNOWLEDGE.md`.

## Hardware lessons already paid for (do not regress)

- Tizen installs: `sdb push` + `shell 0 vd_appinstall` — the `tizen install`
  CLI fails silently on TV firmware.
- `pkgcmd`/kill takes the **package id** (`TvMcpTest0`), not the full app id.
- `shell 0 debug` hangs if the app is already running — kill (by pkgId) and
  clear stale port forwards first; always run it with a timeout.
- Real TVs reject the generic SDK distributor cert; only Samsung-issued
  certificates (DUID-bound) install. `doctor` classifies profiles.
- Samsung HG (hospitality) firmware disables the IP-remote service
  (ports 8001/8002); `remote_key` on those panels = eval_js synthetic
  KeyboardEvents fallback.

## Release flow

Bump version in **three places**: `package.json`, `server.json`,
`src/server.ts` (McpServer version). Update `CHANGELOG.md`
(Keep a Changelog 1.1.0). Commit, then `gh release create vX.Y.Z` —
the publish workflow (npm OIDC trusted publishing + MCP Registry) does the
rest. Versions 0.1.0–0.3.0 are unpublished/burnt on npm; next public release
starts at 0.4.1+.

**Current status: PRIVATE DEVELOPMENT.** Repo is private, npm holds a 0.4.0
name-reservation stub, MCP Registry entry deleted, publish workflow disabled.
Do NOT create GitHub releases or re-enable `publish-mcp.yml` until the
project is cleared to go public again.

## Testing

`npm test` (vitest) — unit tests only, no hardware needed. Hardware
validation is manual against lab TVs configured in `devices.yaml`
(gitignored; contains lab IPs). Drive the server as a real MCP client with
a script using `@modelcontextprotocol/sdk` Client over stdio — see the
lab-test pattern in git history (`lab-test.mjs`, removed).

## Knowledge base

Platform facts, firmware quirks, and hospitality-ecosystem research live in
`docs/KNOWLEDGE.md`. Read it before working on drivers or hospitality
features. Add to it when hardware teaches something new.
