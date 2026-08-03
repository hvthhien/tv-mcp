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

/** LG webOS driver — wraps the `ares-*` CLIs from the webOS TV SDK. */
export class WebOSDriver implements TVDriver {
  readonly platform = "webos" as const;

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
      `{"host":"${config.host}","port":"9922","username":"prisoner"}`,
    ]).catch(async () => {
      // Already registered → modify instead.
      await execa("ares-setup-device", [
        "--modify",
        config.name,
        "--info",
        `{"host":"${config.host}"}`,
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
    await execa("ares-package", [webBuildDir, "-o", outDir]).catch((err) => {
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
            ? "Dev Mode session likely expired (50h limit). Open the Developer Mode app on the TV and re-enable, or use renew_dev_mode."
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
    // ares-inspect launches the app AND starts a local proxy to its inspector.
    // It prints "Application Debugging - http://localhost:<port>" and stays alive;
    // we keep the child running and resolve the page target's CDP websocket URL.
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

  async stop(device: Device, appId: string): Promise<void> {
    await execa("ares-launch", ["--device", device.serial!, "--close", appId]);
  }

  async uninstall(device: Device, appId: string): Promise<void> {
    await execa("ares-install", ["--device", device.serial!, "--remove", appId]);
  }

  async sendKey(_device: Device, key: RemoteKey): Promise<void> {
    // TODO(v0.2): LG SSAP WebSocket — ws://<tv>:3000 (or wss://:3001 on newer firmware).
    // One-time on-screen pairing grants a client-key; persist per device.
    // Then ssap://com.webos.service.networkinput/getPointerInputSocket → button events.
    throw new TVMcpError(
      `remote_key not yet implemented for webOS (key: ${key}).`,
      "Track https://github.com/<owner>/tv-mcp/issues — contributions welcome. Workaround: eval_js can drive most apps by dispatching KeyboardEvent.",
    );
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
