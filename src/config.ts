import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { DeviceConfig, ProjectConfig } from "./types.js";

const deviceSchema = z.object({
  name: z.string(),
  platform: z.enum(["tizen", "webos"]),
  host: z.string(),
  signingProfile: z.string().optional(),
  passphraseEnv: z.string().optional(),
});

const projectSchema = z.object({
  buildCmd: z.string(),
  dist: z.string(),
  tizen: z.object({ appId: z.string(), profile: z.string() }).optional(),
  webos: z.object({ appId: z.string() }).optional(),
});

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
 * 2. ./devices.yaml in cwd
 */
export function loadConfig(explicitPath?: string): TVMcpConfig {
  const path = explicitPath ?? process.env.TV_MCP_CONFIG ?? "devices.yaml";
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
