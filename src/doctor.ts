import { execa } from "execa";
import { readFileSync } from "node:fs";
import { Socket } from "node:net";
import type { TVMcpConfig } from "./config.js";
import type { TokenStore } from "./state.js";

/**
 * Environment preflight. Same philosophy as TVMcpError's remedy field,
 * moved BEFORE the failure: check toolchains, signing profiles, and device
 * reachability in one pass so the agent gets a remediation list instead of
 * discovering problems one install attempt at a time.
 */

interface Check {
  status: "ok" | "warn" | "fail";
  label: string;
  detail?: string;
}

const ICON = { ok: "✓", warn: "⚠", fail: "✗" } as const;

async function cli(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execa(cmd, args, { timeout: 10_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

function probe(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new Socket();
    const done = (up: boolean) => {
      sock.destroy();
      resolve(up);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, host);
  });
}

/**
 * Classify a Tizen security profile by its distributor certificate path.
 * Real TVs reject the SDK's generic distributor cert; only Samsung-issued
 * certificates (which embed device DUIDs) install on hardware.
 */
export function classifyProfile(distributorKeyPath: string): "samsung" | "generic" | "unknown" {
  if (/SamsungCertificate/i.test(distributorKeyPath)) return "samsung";
  if (/certificate-generator|tizen-distributor-signer|\bdistributor\/sdk/i.test(distributorKeyPath)) {
    return "generic";
  }
  return "unknown";
}

/** Parse profile name → distributor key path pairs out of Tizen's profiles.xml. */
export function parseProfilesXml(xml: string): Array<{ name: string; distributorKey: string }> {
  const out: Array<{ name: string; distributorKey: string }> = [];
  const profileRe = /<profile\s+name="([^"]+)"[\s\S]*?<\/profile>/g;
  for (const m of xml.matchAll(profileRe)) {
    // distributor items follow the author item; grab the first non-author key
    const keys = [...m[0].matchAll(/key="([^"]*)"/g)].map((k) => k[1]).filter(Boolean);
    const distributor = keys.find((k) => !/author/i.test(k)) ?? "";
    out.push({ name: m[1], distributorKey: distributor });
  }
  return out;
}

export async function runDoctor(config: TVMcpConfig, store: TokenStore): Promise<string> {
  const checks: Check[] = [];

  // ---- toolchains ----
  const sdb = await cli("sdb", ["version"]);
  checks.push(
    sdb
      ? { status: "ok", label: "sdb", detail: sdb.split("\n")[0] }
      : { status: "warn", label: "sdb not on PATH", detail: "Tizen targets unavailable. Install Tizen Studio CLI." },
  );
  const tizen = await cli("tizen", ["version"]);
  checks.push(
    tizen
      ? { status: "ok", label: "tizen CLI", detail: tizen.split("\n")[0] }
      : { status: "warn", label: "tizen CLI not on PATH", detail: "Packaging/signing for Samsung unavailable. Install Tizen Studio CLI." },
  );
  const ares = await cli("ares-setup-device", ["--version"]);
  checks.push(
    ares
      ? { status: "ok", label: "ares CLI", detail: ares.split("\n")[0] }
      : { status: "warn", label: "ares-* not on PATH", detail: "webOS targets unavailable. npm i -g @webos-tools/cli" },
  );
  if (!sdb && !ares) {
    checks.push({
      status: "fail",
      label: "no vendor toolchain at all",
      detail: "tv-mcp orchestrates the vendor CLIs; install at least one. See docs topic device-setup.",
    });
  }

  // ---- tizen signing profiles ----
  if (tizen) {
    const list = await cli("tizen", ["security-profiles", "list"]);
    const xmlPath = list?.match(/Loaded in '([^']+)'/)?.[1];
    if (!xmlPath) {
      checks.push({
        status: "warn",
        label: "no Tizen certificate profiles found",
        detail: "Create one in Tizen Studio's certificate manager. Real TVs need a Samsung-issued certificate — docs topic tizen-signing.",
      });
    } else {
      let profiles: Array<{ name: string; distributorKey: string }> = [];
      try {
        profiles = parseProfilesXml(readFileSync(xmlPath, "utf8"));
      } catch {
        /* unreadable profiles.xml — fall through to empty */
      }
      if (profiles.length === 0) {
        checks.push({ status: "warn", label: "certificate profiles list is empty", detail: xmlPath });
      }
      for (const p of profiles) {
        const kind = classifyProfile(p.distributorKey);
        checks.push(
          kind === "samsung"
            ? { status: "ok", label: `profile '${p.name}'`, detail: "Samsung-issued distributor cert (installs on real TVs)" }
            : kind === "generic"
              ? { status: "warn", label: `profile '${p.name}' uses the generic SDK distributor cert`, detail: "Real TVs reject it (emulator only). Issue a Samsung certificate with your TV DUIDs — docs topic tizen-signing." }
              : { status: "warn", label: `profile '${p.name}' has an unrecognized distributor cert`, detail: p.distributorKey || "(none)" },
        );
      }
    }
  }

  // ---- configured devices ----
  if (config.devices.length === 0) {
    checks.push({
      status: "warn",
      label: "no devices configured",
      detail: "Add TVs to devices.yaml or use connect_device with host+platform.",
    });
  }
  for (const d of config.devices) {
    const port = d.platform === "tizen" ? 26101 : 9922;
    const up = await probe(d.host, port);
    checks.push(
      up
        ? { status: "ok", label: `${d.name} (${d.platform}) reachable`, detail: `${d.host}:${port}` }
        : {
            status: "fail",
            label: `${d.name} (${d.platform}) unreachable on ${d.host}:${port}`,
            detail:
              d.platform === "tizen"
                ? "TV off/standby, wrong subnet, or dev mode not armed (Host PC IP must be this machine's address on the TV's subnet, then reboot the TV). Docs topic device-setup."
                : "TV off/standby, wrong subnet, or Dev Mode session expired (~50h). Re-enable in the Developer Mode app. Docs topic webos-dev-mode.",
          },
    );
    if (d.platform === "webos") {
      if (d.passphraseEnv && !process.env[d.passphraseEnv]) {
        checks.push({
          status: "warn",
          label: `${d.name}: env var ${d.passphraseEnv} is not set`,
          detail: "Key exchange with the Dev Mode app will fail. Export the passphrase shown on the TV.",
        });
      }
      if (store.get("lg-client-keys", d.name)) {
        checks.push({ status: "ok", label: `${d.name}: SSAP client-key on file`, detail: "remote_key will not re-prompt" });
      }
    } else if (store.get("samsung-tokens", d.name)) {
      checks.push({ status: "ok", label: `${d.name}: remote token on file`, detail: "remote_key will not re-prompt" });
    }
  }

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const lines = checks.map((c) => `${ICON[c.status]} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
  const verdict =
    fails > 0
      ? `${fails} blocking issue(s), ${warns} warning(s). Fix the ✗ items before build/install.`
      : warns > 0
        ? `Usable with caveats: ${warns} warning(s).`
        : "All checks passed. Ready to build, install, and debug.";
  return `${lines.join("\n")}\n\n${verdict}`;
}
