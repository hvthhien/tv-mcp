import { execa } from "execa";
import { join } from "node:path";
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

/** Samsung Tizen driver — wraps the `tizen` and `sdb` CLIs from Tizen Studio. */
export class TizenDriver implements TVDriver {
  readonly platform = "tizen" as const;

  async listDevices(): Promise<Device[]> {
    const { stdout } = await execa("sdb", ["devices"]).catch((err) => {
      throw new TVMcpError(
        `sdb not runnable: ${err.shortMessage ?? err.message}`,
        "Install Tizen Studio CLI and ensure sdb is on PATH.",
      );
    });
    // Output: "List of devices attached\n<serial>\tdevice\t<name>"
    return stdout
      .split("\n")
      .slice(1)
      .filter((l) => l.trim() && l.includes("device"))
      .map((l) => {
        const [serial, , name] = l.split("\t");
        return {
          name: name?.trim() || serial,
          platform: this.platform,
          host: serial.split(":")[0],
          serial,
          reachable: true,
        };
      });
  }

  async connect(config: DeviceConfig): Promise<Device> {
    const target = config.host.includes(":") ? config.host : `${config.host}:26101`;
    const { stdout } = await execa("sdb", ["connect", target]);
    if (stdout.includes("error") || stdout.includes("failed")) {
      throw new TVMcpError(
        `sdb connect ${target} failed: ${stdout}`,
        "On the TV: enable Developer Mode (Apps → 12345 → Developer mode ON, set Host PC IP to this machine), then reboot the TV.",
      );
    }
    return { ...config, serial: target, reachable: true };
  }

  async package(project: ProjectConfig, webBuildDir: string): Promise<Artifact> {
    if (!project.tizen) {
      throw new TVMcpError(
        `Project '${project.name}' has no tizen section in devices.yaml.`,
        "Add tizen: { appId, profile } to the project config.",
      );
    }
    // Signing happens here: -s selects the certificate profile registered in
    // Tizen Studio's certificate manager. Partner-level privileges require the
    // target TV's DUID in the distributor certificate — see docs/tizen-signing.md.
    await execa(
      "tizen",
      ["package", "-t", "wgt", "-s", project.tizen.profile, "--", webBuildDir],
    ).catch((err) => {
      throw new TVMcpError(
        `tizen package failed: ${err.stderr ?? err.message}`,
        `Check certificate profile '${project.tizen!.profile}' exists (tizen security-profiles list) and is not expired. See resource tvmcp://docs/tizen-signing.`,
      );
    });
    // tizen CLI writes <name>.wgt next to the build dir; locate the newest .wgt.
    const { stdout } = await execa("sh", [
      "-c",
      `ls -t ${join(webBuildDir, "*.wgt")} 2>/dev/null | head -1`,
    ]);
    if (!stdout.trim()) {
      throw new TVMcpError(`Packaging reported success but no .wgt found in ${webBuildDir}.`);
    }
    return { platform: this.platform, path: stdout.trim(), appId: project.tizen.appId };
  }

  async install(device: Device, artifact: Artifact): Promise<void> {
    await execa("tizen", [
      "install",
      "--name",
      artifact.path,
      "--serial",
      this.serial(device),
    ]).catch((err) => {
      const msg: string = err.stderr ?? err.message;
      if (msg.includes("signature") || msg.includes("cert")) {
        throw new TVMcpError(
          `Install rejected by TV (signature): ${msg}`,
          "The distributor certificate likely does not include this TV's DUID. Read tvmcp://docs/tizen-signing and re-issue the certificate with this device's DUID.",
        );
      }
      throw new TVMcpError(`tizen install failed: ${msg}`);
    });
  }

  async launch(device: Device, appId: string, debug: boolean): Promise<LaunchResult> {
    const serial = this.serial(device);
    if (!debug) {
      await execa("tizen", ["run", "--pkg-id", appId, "--serial", serial]);
      return { appId };
    }
    // Debug launch: TV starts the web inspector on a random port, printed to stdout.
    // We sdb-forward it locally, then resolve the page target's CDP websocket URL.
    const { stdout } = await execa("sdb", ["-s", serial, "shell", "0", "debug", appId]);
    const port = stdout.match(/port:?\s*(\d+)/i)?.[1];
    if (!port) {
      throw new TVMcpError(
        `Debug launch did not report an inspector port. Output: ${stdout}`,
        "Some firmware needs `sdb shell 0 debug <appId> 0` (extra arg). Try launching without debug to confirm the app itself starts.",
      );
    }
    const localPort = 9998;
    await execa("sdb", ["-s", serial, "forward", `tcp:${localPort}`, `tcp:${port}`]);
    const targets = (await fetch(`http://127.0.0.1:${localPort}/json`).then((r) =>
      r.json(),
    )) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) {
      throw new TVMcpError(`No debuggable page target on inspector port ${port}.`);
    }
    return { appId, cdpUrl: page.webSocketDebuggerUrl };
  }

  async stop(device: Device, appId: string): Promise<void> {
    await execa("sdb", ["-s", this.serial(device), "shell", "0", "kill", appId]);
  }

  async uninstall(device: Device, appId: string): Promise<void> {
    await execa("tizen", ["uninstall", "--pkg-id", appId, "--serial", this.serial(device)]);
  }

  async sendKey(_device: Device, key: RemoteKey): Promise<void> {
    // TODO(v0.2): Samsung remote WebSocket API — wss://<tv>:8002/api/v2/channels/samsung.remote.control
    // Requires one-time on-screen pairing; persist the granted token per device.
    // Key codes: KEY_UP, KEY_DOWN, KEY_ENTER, KEY_RETURN, ... (map from RemoteKey).
    throw new TVMcpError(
      `remote_key not yet implemented for Tizen (key: ${key}).`,
      "Track https://github.com/<owner>/tv-mcp/issues — contributions welcome. Workaround: eval_js can drive most apps by dispatching KeyboardEvent.",
    );
  }

  async logs(device: Device, lines: number): Promise<LogEntry[]> {
    const { stdout } = await execa("sdb", [
      "-s",
      this.serial(device),
      "shell",
      "0",
      "showlog_dump",
    ]).catch(() => ({ stdout: "" }));
    return stdout
      .split("\n")
      .slice(-lines)
      .filter(Boolean)
      .map((message) => ({
        timestamp: new Date().toISOString(),
        level: "info" as const,
        source: "platform" as const,
        message,
      }));
  }

  private serial(device: Device): string {
    if (!device.serial) {
      throw new TVMcpError(
        `Device '${device.name}' is not connected.`,
        "Call connect_device first.",
      );
    }
    return device.serial;
  }
}
