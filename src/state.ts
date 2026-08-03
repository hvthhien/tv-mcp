import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Persists per-device pairing secrets (Samsung remote tokens, LG SSAP
 * client-keys) so the on-screen approval prompt happens exactly once.
 *
 * Stored outside the repo (~/.tv-mcp/state.json) — these are secrets for
 * physical devices and must never end up in version control.
 */
export class TokenStore {
  private data: Record<string, Record<string, string>> = {};

  constructor(
    private readonly path: string = process.env.TV_MCP_STATE ??
      join(homedir(), ".tv-mcp", "state.json"),
  ) {
    try {
      this.data = JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      this.data = {};
    }
  }

  get(namespace: string, device: string): string | undefined {
    return this.data[namespace]?.[device];
  }

  set(namespace: string, device: string, value: string): void {
    (this.data[namespace] ??= {})[device] = value;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
}
