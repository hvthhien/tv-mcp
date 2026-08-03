# Contributing

## Setup

```bash
npm install
npm run build
npm test
```

No TV required for most work: driver logic is behind the `TVDriver` interface ([src/types.ts](src/types.ts)) and unit tests mock the vendor CLIs.

## Where help is most wanted

1. **Remote-key pairing** — Samsung remote WebSocket API and LG SSAP client, including token persistence (`docs` topic `remote-key-pairing` has the protocol notes).
2. **webOS dev-mode auto-renew** — session token refresh against the Dev Mode app.
3. **New drivers** — Vizio SmartCast, Roku, Android TV / Fire TV. Implement `TVDriver`, register it in `server.ts`, done.
4. **Real-device testing** — we can't own every panel year. Reports from real hardware (model + firmware + what broke) are gold.

## Ground rules

- Every thrown error must be a `TVMcpError` with a `remedy` — errors are read by agents, and an agent can only fix what the error tells it to fix.
- Tool descriptions stay one sentence. Deep platform knowledge goes in `src/docs.ts`, disclosed on demand.
- New tools must declare their tier (0/1/2) and respect progressive disclosure.

## Releases

Semver. `npm run build && npm publish` from a tagged main.
