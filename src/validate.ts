import { isIP } from "node:net";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { TVMcpError } from "./types.js";

/** Tizen pkg ids / app ids and webOS reverse-DNS ids. Must not start with "-" (CLI flag injection). */
export const APP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._]{0,127}$/;
/** Device names end up in CLI args and state keys. */
export const DEVICE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HOSTNAME_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
/** Shell metacharacters that only mean something to a shell; we never run one. */
const SHELL_META_RE = /[;&|<>`$(){}\\\n\r*?~]/;

export function assertAppId(appId: string): string {
  if (!APP_ID_RE.test(appId)) {
    throw new TVMcpError(
      `Invalid appId '${appId}'.`,
      "App ids may contain only letters, digits, '.' and '_', and must start with a letter or digit.",
    );
  }
  return appId;
}

export function assertDeviceName(name: string): string {
  if (!DEVICE_NAME_RE.test(name)) {
    throw new TVMcpError(
      `Invalid device name '${name}'.`,
      "Names may contain only letters, digits, '.', '_' and '-', and must start with a letter or digit.",
    );
  }
  return name;
}

/** Accepts an IPv4/IPv6 literal, a hostname, or either with a :port suffix (IPv4/hostname only). */
export function assertHost(host: string): string {
  const bare = host.replace(/:\d{1,5}$/, "");
  if (isIP(host) || isIP(bare) || (!bare.startsWith("-") && HOSTNAME_RE.test(bare))) {
    return host;
  }
  throw new TVMcpError(
    `Invalid host '${host}'.`,
    "Provide an IP address or hostname, optionally with :port.",
  );
}

/**
 * Artifact paths from the model must be .wgt/.ipk files inside the project's
 * dist directories or the tv-mcp temp dir — not arbitrary files on disk.
 */
export function assertArtifactPath(path: string, allowedRoots: string[]): string {
  const abs = resolve(path);
  const ext = extname(abs).toLowerCase();
  if (ext !== ".wgt" && ext !== ".ipk") {
    throw new TVMcpError(`Refusing to install '${basename(path)}': only .wgt and .ipk packages are allowed.`);
  }
  const roots = [...allowedRoots.map((r) => resolve(r)), resolve(tmpdir(), "tv-mcp-ipk")];
  const ok = roots.some((root) => {
    const rel = relative(root, abs);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  });
  if (!ok) {
    throw new TVMcpError(
      `Artifact path is outside the allowed directories.`,
      "Use the path returned by build_app, or a package inside a configured project's dist directory.",
    );
  }
  return abs;
}

/**
 * Split a build command into argv WITHOUT a shell. Supports plain words and
 * simple '…' / "…" quoting; rejects shell syntax (pipes, &&, $VAR, globs…)
 * rather than silently interpreting it. Use the array form in devices.yaml
 * for anything unusual.
 */
export function parseCommand(cmd: string | string[]): string[] {
  if (Array.isArray(cmd)) {
    if (cmd.length === 0 || cmd.some((a) => typeof a !== "string")) {
      throw new TVMcpError("buildCmd array must be a non-empty list of strings.");
    }
    return cmd;
  }
  const argv: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (const ch of cmd.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) argv.push(cur);
      cur = "";
      has = false;
    } else if (SHELL_META_RE.test(ch)) {
      throw new TVMcpError(
        `buildCmd contains shell syntax ('${ch}'), which tv-mcp does not interpret.`,
        'Use a single command (e.g. "npm run build"), put the steps in an npm script, or write buildCmd as a YAML list: [npm, run, build].',
      );
    } else {
      cur += ch;
    }
  }
  if (quote) throw new TVMcpError("buildCmd has an unterminated quote.");
  if (has || cur) argv.push(cur);
  if (argv.length === 0) throw new TVMcpError("buildCmd is empty.");
  return argv;
}
