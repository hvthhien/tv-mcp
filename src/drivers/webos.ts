import { execa } from "execa";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  Artifact,
  Device,
  DeviceConfig,
  LaunchResult,
  LogEntry,
  ProjectConfig,
  RemoteKey,
  TVDriver,
} from "../types.js";
import { TVMcpError } from "../types.js";
import { LgRemote } from "../remote/ssap.js";
import type { TokenStore } from "../state.js";

/** URL for LG's Dev Mode session-reset endpoint. Exported for tests. */
export function devModeResetUrl(sessionToken: string): string {
  return `https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken=${encodeURIComponent(sessionToken)}`;
}

/** LG webOS driver — wraps the `ares-*` CLIs from the webOS TV SDK. */
export class WebOSDriver implements TVDriver {
  readonly platform = "webos" as const;
  private remotes = new Map<string, LgRemote>();

  constructor(private readonly store: TokenStore) {}

  async listDevices(): Promise<Device[]> {
    const { stdout } = await execa("ares-setup-device", ["--list"]).catch((err) => {
      throw new TVMcpError(
        `ares-setup-device not runnable: ${err.shortMessage ?? err.message}`,
        "Install the webOS TV CLI (npm i -g @webos-tools/cli) and ensure ares-* is on PATH.",
      );
    });
    // Output columns: name deviceinfo connection profile
    return stdout
      .split("\n")
      .slice(1)
      .filter((l) => l.trim() && !l.startsWith("emulator"))
      .map((l) => {
        const [name, deviceinfo] = l.trim().split(/\s+/);
        return {
          name,
          platform: this.platform,
          host: deviceinfo?.split("@")[1]?.split(":")[0] ?? "",
          serial: name,
          reachable: true,
        };
      });
  }

  async connect(config: DeviceConfig): Promise<Device> {
    // Registers (or updates) the device with the ares tooling. The TV must have
    // the Developer Mode app installed and running — see tvmcp://docs/webos-dev-mode.
    await execa("ares-setup-device", [
      "--add",
      config.name,
      "--info",
      JSON.stringify({ host: config.host, port: "9922", username: "prisoner" }),
    ]).catch(async () => {
      // Already registered → modify instead.
      await execa("ares-setup-device", [
        "--modify",
        config.name,
        "--info",
        JSON.stringify({ host: config.host }),
      ]);
    });
    // getkey pulls the SSH key from the Dev Mode app; needs the passphrase shown on-TV.
    const passphrase = config.passphraseEnv ? process.env[config.passphraseEnv] : undefined;
    if (passphrase) {
      await execa("ares-novacom", ["--device", config.name, "--getkey"], {
        input: `${passphrase}\n`,
      }).catch((err) => {
        throw new TVMcpError(
          `Key exchange with Dev Mode app failed: ${err.stderr ?? err.message}`,
          "Open the Developer Mode app on the TV, confirm Dev Mode is ON and the session timer is not expired, and check the passphrase env var matches the one on screen.",
        );
      });
    }
    return { ...config, serial: config.name, reachable: true };
  }

  async package(project: ProjectConfig, webBuildDir: string): Promise<Artifact> {
    if (!project.webos) {
      throw new TVMcpError(
        `Project '${project.name}' has no webos section in devices.yaml.`,
        "Add webos: { appId } to the project config.",
      );
    }
    const outDir = join(tmpdir(), "tv-mcp-ipk");
    // --no-minify: minified apps are not inspectable on-device; tv-mcp builds
    // exist to be debugged, so debuggability beats bundle size here.
    await execa("ares-package", [webBuildDir, "-o", outDir, "--no-minify"]).catch((err) => {
      throw new TVMcpError(
        `ares-package failed: ${err.stderr ?? err.message}`,
        "The build dir must contain appinfo.json with a matching id. See tvmcp://docs/webos-packaging.",
      );
    });
    const ipks = (await readdir(outDir)).filter((f) => f.endsWith(".ipk"));
    if (ipks.length === 0) {
      throw new TVMcpError(`ares-package reported success but no .ipk in ${outDir}.`);
    }
    return {
      platform: this.platform,
      path: join(outDir, ipks[0]),
      appId: project.webos.appId,
    };
  }

  async install(device: Device, artifact: Artifact): Promise<void> {
    await execa("ares-install", ["--device", device.serial!, artifact.path]).catch(
      (err) => {
        const msg: string = err.stderr ?? err.message;
        throw new TVMcpError(
          `ares-install failed: ${msg}`,
          msg.includes("connect")
            ? "Dev Mode session likely expired (sessions run out if not extended). Open the Developer Mode app on the TV and re-enable, or use renew_dev_mode."
            : undefined,
        );
      },
    );
  }

  async launch(device: Device, appId: string, debug: boolean): Promise<LaunchResult> {
    if (!debug) {
      await execa("ares-launch", ["--device", device.serial!, appId]);
      return { appId };
    }
    // Preferred path: the dev-mode inspector listens on TV port 9998 over
    // plain HTTP/WS, so after a normal launch we can resolve the CDP websocket
    // directly — no long-lived ares-inspect child to babysit.
    // (docs/KNOWLEDGE.md "webOS platform internals"; unvalidated on hardware
    // until the lab LG panel arrives — ares-inspect remains the fallback.)
    try {
      await execa("ares-launch", ["--device", device.serial!, appId]);
      const direct = await this.resolveDirectCdp(device, appId);
      if (direct) return { appId, cdpUrl: direct };
    } catch {
      /* fall through to ares-inspect */
    }
    // Fallback: ares-inspect launches the app AND starts a local proxy to its
    // inspector. It prints "Application Debugging - http://localhost:<port>"
    // and stays alive; we keep the child running and resolve the CDP URL.
    const child = execa("ares-inspect", ["--device", device.serial!, "--app", appId]);
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new TVMcpError("ares-inspect produced no inspector URL within 30s.")),
        30_000,
      );
      child.stdout?.on("data", (chunk: Buffer) => {
        const m = chunk.toString().match(/https?:\/\/localhost:\d+/);
        if (m) {
          clearTimeout(timer);
          resolve(m[0]);
        }
      });
      child.catch(reject);
    });
    const targets = (await fetch(`${url}/json`).then((r) => r.json())) as Array<{
      type: string;
      webSocketDebuggerUrl?: string;
    }>;
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) {
      throw new TVMcpError(`No debuggable page target at ${url}.`);
    }
    return { appId, cdpUrl: page.webSocketDebuggerUrl };
  }

  /**
   * Resolve the app's CDP websocket straight from the TV's dev-mode inspector
   * port (9998). Tries /json/list (newer firmware) then /pagelist.json
   * (older). Returns null when the port is closed or the app has no target.
   */
  private async resolveDirectCdp(device: Device, appId: string): Promise<string | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(`http://${device.host}:9998/json/list`, {
          signal: AbortSignal.timeout(2000),
        });
        const targets = (await res.json()) as Array<{
          type?: string;
          url?: string;
          title?: string;
          webSocketDebuggerUrl?: string;
        }>;
        const page =
          targets.find(
            (t) => t.webSocketDebuggerUrl && (t.url?.includes(appId) || t.title?.includes(appId)),
          ) ?? targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      } catch {
        /* port closed or app not up yet — retry */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  }

  async stop(device: Device, appId: string): Promise<void> {
    await execa("ares-launch", ["--device", device.serial!, "--close", appId]);
  }

  async uninstall(device: Device, appId: string): Promise<void> {
    await execa("ares-install", ["--device", device.serial!, "--remove", appId]);
  }

  async sendKey(device: Device, key: RemoteKey): Promise<void> {
    let remote = this.remotes.get(device.name);
    if (!remote) {
      remote = new LgRemote(device.host, device.name, this.store);
      this.remotes.set(device.name, remote);
    }
    await remote.sendKey(key);
  }

  /**
   * Extend the Dev Mode session without touching the TV: read the session
   * token from the panel (/var/luna/preferences/devmode_enabled) and hit
   * LG's ResetDevModeSession endpoint — the same mechanism the Dev Mode
   * app's EXTEND button and community keep-alive tools use.
   * (docs/KNOWLEDGE.md "webOS platform internals"; REPORTED-grade —
   * unvalidated on our hardware until the lab LG panel arrives.)
   */
  async renewDevMode(device: Device): Promise<string> {
    const token = await this.readDevModeToken(device);
    const res = await fetch(devModeResetUrl(token), {
      signal: AbortSignal.timeout(15_000),
    }).catch((err) => {
      throw new TVMcpError(
        `Could not reach developer.lge.com: ${(err as Error).message}`,
        "Session renewal needs internet access from this machine (not the TV).",
      );
    });
    const body = await res.text();
    if (!res.ok) {
      throw new TVMcpError(
        `ResetDevModeSession returned HTTP ${res.status}: ${body.slice(0, 200)}`,
        "Token may be stale (Dev Mode re-enabled since last key exchange) or the session already hit zero — at 0 the session cannot be extended remotely; re-enable Dev Mode on the TV.",
      );
    }
    return `Dev Mode session extended for ${device.name}. LG response: ${body.slice(0, 200)}`;
  }

  private async readDevModeToken(device: Device): Promise<string> {
    const path = "/var/luna/preferences/devmode_enabled";
    // Try a remote cat first; fall back to pulling the file. Both ride the
    // dev-mode SSH session, so either works only while the session is alive.
    const viaShell = await execa("ares-shell", ["--device", device.serial!, "-r", `cat ${path}`])
      .then((r) => r.stdout.trim())
      .catch(() => null);
    let token = viaShell;
    if (!token) {
      const tmp = join(tmpdir(), `tv-mcp-devmode-${device.name}`);
      token = await execa("ares-pull", ["--device", device.serial!, path, tmp])
        .then(async () => (await import("node:fs/promises")).readFile(tmp, "utf8"))
        .then((s) => s.trim())
        .catch(() => null);
    }
    if (!token || !/^[A-Za-z0-9+/=_-]{8,}$/.test(token)) {
      throw new TVMcpError(
        `Could not read a Dev Mode session token from ${device.name}${token ? ` (unexpected content: ${token.slice(0, 40)}...)` : ""}.`,
        "The TV must be on with an active Dev Mode session (renewal only works while the timer is above zero). If the session already expired, re-enable Dev Mode in the app on the TV.",
      );
    }
    return token;
  }

  async logs(device: Device, lines: number): Promise<LogEntry[]> {
    const { stdout } = await execa("ares-log", [
      "--device",
      device.serial!,
      "--lines",
      String(lines),
    ]).catch(() => ({ stdout: "" }));
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((message) => ({
        timestamp: new Date().toISOString(),
        level: "info" as const,
        source: "platform" as const,
        message,
      }));
  }
}
