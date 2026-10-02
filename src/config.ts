import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { assertAppId, assertDeviceName, assertHost, parseCommand } from "./validate.js";
import type { DeviceConfig, ProjectConfig } from "./types.js";

const deviceSchema = z.object({
  name: z.string().refine((v) => ok(() => assertDeviceName(v)), "invalid device name"),
  platform: z.enum(["tizen", "webos"]),
  host: z.string().refine((v) => ok(() => assertHost(v)), "invalid host"),
  signingProfile: z.string().optional(),
  // Restricted so a config author cannot make the server read arbitrary
  // environment variables (AWS_*, tokens…) and send them to a TV.
  passphraseEnv: z.string().regex(/^TV_MCP_[A-Z0-9_]+$|^[A-Z0-9_]*PASSPHRASE[A-Z0-9_]*$/, "passphraseEnv must be named TV_MCP_* or contain PASSPHRASE").optional(),
});

const appId = z.string().refine((v) => ok(() => assertAppId(v)), "invalid appId");

const projectSchema = z.object({
  buildCmd: z.union([z.string(), z.array(z.string())]).refine((v) => ok(() => parseCommand(v)), "buildCmd contains shell syntax; use a plain command or a YAML list"),
  dist: z.string(),
  tizen: z.object({ appId, profile: z.string() }).optional(),
  webos: z.object({ appId }).optional(),
});

function ok(fn: () => unknown): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

const configSchema = z.object({
  devices: z.array(deviceSchema).default([]),
  projects: z.record(projectSchema).default({}),
});

export interface TVMcpConfig {
  devices: DeviceConfig[];
  projects: Record<string, ProjectConfig>;
}

/**
 * Loads devices.yaml. Path resolution order:
 * 1. --config CLI flag / TV_MCP_CONFIG env var
 * 2. ~/.tv-mcp/devices.yaml
 *
 * The working directory is deliberately NOT searched: the config defines
 * build commands that get executed, so it must never be picked up from an
 * untrusted checkout the server happens to be started in.
 */
export function loadConfig(explicitPath?: string): TVMcpConfig {
  const path = explicitPath ?? process.env.TV_MCP_CONFIG ?? join(homedir(), ".tv-mcp", "devices.yaml");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // No config file is a valid state: devices can still be discovered live.
    return { devices: [], projects: {} };
  }
  const parsed = configSchema.parse(parse(raw));
  return {
    devices: parsed.devices,
    projects: Object.fromEntries(
      Object.entries(parsed.projects).map(([name, p]) => [name, { name, ...p }]),
    ),
  };
}
