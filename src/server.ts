import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execa } from "execa";
import { z } from "zod";
import { CdpBridge } from "./cdp/bridge.js";
import type { TVMcpConfig } from "./config.js";
import { DOCS } from "./docs.js";
import { DeviceRegistry } from "./registry.js";
import { TokenStore } from "./state.js";
import { TizenDriver } from "./drivers/tizen.js";
import { WebOSDriver } from "./drivers/webos.js";
import type { Artifact, Platform, RemoteKey } from "./types.js";
import { TVMcpError } from "./types.js";

const REMOTE_KEYS = [
  "UP", "DOWN", "LEFT", "RIGHT", "OK", "BACK", "HOME",
  "PLAY", "PAUSE", "STOP", "REWIND", "FAST_FORWARD",
  "VOLUME_UP", "VOLUME_DOWN", "MUTE", "CHANNEL_UP", "CHANNEL_DOWN",
  "RED", "GREEN", "YELLOW", "BLUE", "EXIT",
] as const;

/**
 * Builds the MCP server with three progressively disclosed tool tiers:
 *
 *   Tier 0 (always):        list_devices, connect_device, docs
 *   Tier 1 (device online): build_app, install_app, launch_app, stop_app,
 *                           uninstall_app, device_logs, remote_key
 *   Tier 2 (debug session): screenshot, eval_js, console_logs
 *
 * Tiers are enabled via tool.enable(), which emits tools/list_changed so the
 * client refreshes. A fresh session costs the model 3 tool schemas, not 13.
 */
export function buildServer(config: TVMcpConfig): McpServer {
  const server = new McpServer({ name: "tv-mcp", version: "0.2.3" });

  const store = new TokenStore();
  const registry = new DeviceRegistry(
    { tizen: new TizenDriver(store), webos: new WebOSDriver(store) },
    config.devices,
  );
  const cdp = new CdpBridge();
  const artifacts = new Map<Platform, Artifact>();

  const tier1: RegisteredTool[] = [];
  const tier2: RegisteredTool[] = [];
  const enableTier = (tier: RegisteredTool[]) => {
    for (const t of tier) if (!t.enabled) t.enable();
  };

  const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

  // ---------- Tier 0: always visible ----------

  server.registerTool(
    "list_devices",
    {
      title: "List TVs",
      description:
        "List configured and live-discovered Samsung (Tizen) / LG (webOS) TVs with reachability.",
      inputSchema: {},
    },
    async () => {
      const drivers: Platform[] = ["tizen", "webos"];
      for (const p of drivers) {
        // Live discovery is best-effort; missing vendor CLI must not break the other platform.
        try {
          for (const d of await registry
            .driverFor({ platform: p } as never)
            .listDevices()) {
            if (!registry.list().some((k) => k.name === d.name)) {
              await registry.connect(d);
            }
          }
        } catch {
          /* vendor CLI absent — configured devices still listed */
        }
      }
      const rows = registry
        .list()
        .map(
          (d) =>
            `${d.reachable ? "🟢" : "⚪"} ${d.name}  [${d.platform}]  ${d.host}${d.serial ? `  (${d.serial})` : ""}`,
        );
      return text(rows.join("\n") || "No devices configured or discovered. Use connect_device.");
    },
  );

  server.registerTool(
    "connect_device",
    {
      title: "Connect TV",
      description:
        "Connect to a TV by configured name or by host+platform. Unlocks app lifecycle tools.",
      inputSchema: {
        name: z.string().optional().describe("Configured device name from devices.yaml"),
        host: z.string().optional().describe("TV IP address (when not configured)"),
        platform: z.enum(["tizen", "webos"]).optional().describe("Required with host"),
      },
    },
    async ({ name, host, platform }) => {
      const cfg = name
        ? registry.get(name)
        : host && platform
          ? { name: `${platform}-${host}`, platform, host }
          : null;
      if (!cfg) {
        throw new TVMcpError("Provide either name, or host + platform.");
      }
      const device = await registry.connect(cfg);
      enableTier(tier1); // progressive disclosure: lifecycle tools appear now
      return text(
        `Connected: ${device.name} [${device.platform}] ${device.host}.\n` +
          `App lifecycle tools are now available (build_app, install_app, launch_app, ...).`,
      );
    },
  );

  server.registerTool(
    "docs",
    {
      title: "Platform docs",
      description:
        "Deep docs for platform pain points (signing, dev mode, packaging, pairing). Call without a topic to list topics.",
      inputSchema: {
        topic: z.string().optional().describe(`One of: ${Object.keys(DOCS).join(", ")}`),
      },
    },
    async ({ topic }) => {
      if (!topic) {
        return text(
          Object.entries(DOCS)
            .map(([k, v]) => `- ${k}: ${v.title}`)
            .join("\n"),
        );
      }
      const doc = DOCS[topic];
      if (!doc) {
        throw new TVMcpError(`Unknown topic '${topic}'.`, `Topics: ${Object.keys(DOCS).join(", ")}`);
      }
      return text(doc.body);
    },
  );

  for (const [key, doc] of Object.entries(DOCS)) {
    server.registerResource(
      `docs-${key}`,
      `tvmcp://docs/${key}`,
      { title: doc.title, mimeType: "text/markdown" },
      async (uri) => ({ contents: [{ uri: uri.href, text: doc.body }] }),
    );
  }

  // ---------- Tier 1: app lifecycle (enabled on first device connect) ----------

  tier1.push(
    server.registerTool(
      "build_app",
      {
        title: "Build & package",
        description:
          "Run the project's web build once, then package for the target platform (.wgt or .ipk).",
        inputSchema: {
          project: z.string().describe(`Project from devices.yaml: ${Object.keys(config.projects).join(", ") || "(none configured)"}`),
          platform: z.enum(["tizen", "webos"]),
          skipWebBuild: z.boolean().optional().describe("Package the existing dist dir without rebuilding"),
        },
      },
      async ({ project, platform, skipWebBuild }) => {
        const proj = config.projects[project];
        if (!proj) {
          throw new TVMcpError(
            `Unknown project '${project}'.`,
            `Configured projects: ${Object.keys(config.projects).join(", ") || "none — add one to devices.yaml"}`,
          );
        }
        if (!skipWebBuild) {
          await execa(proj.buildCmd, { shell: true }).catch((err) => {
            throw new TVMcpError(`Web build failed:\n${err.stderr ?? err.message}`);
          });
        }
        const driver = registry.driverFor({ platform } as never);
        const artifact = await driver.package(proj, proj.dist);
        artifacts.set(platform, artifact);
        return text(`Packaged ${artifact.path} (appId ${artifact.appId}). Next: install_app.`);
      },
    ),

    server.registerTool(
      "install_app",
      {
        title: "Install app",
        description: "Install the last-built artifact (or an explicit path) on a TV.",
        inputSchema: {
          device: z.string().describe("Device name"),
          artifactPath: z.string().optional().describe("Defaults to the last build_app output for the device's platform"),
          appId: z.string().optional().describe("Required with artifactPath"),
        },
      },
      async ({ device: name, artifactPath, appId }) => {
        const device = registry.get(name);
        const artifact: Artifact | undefined = artifactPath
          ? { platform: device.platform, path: artifactPath, appId: appId ?? "" }
          : artifacts.get(device.platform);
        if (!artifact) {
          throw new TVMcpError(`No artifact for ${device.platform}.`, "Run build_app first.");
        }
        await registry.driverFor(device).install(device, artifact);
        return text(`Installed ${artifact.appId} on ${device.name}. Next: launch_app (debug=true enables screenshot/console/eval tools).`);
      },
    ),

    server.registerTool(
      "launch_app",
      {
        title: "Launch app",
        description:
          "Launch an app on a TV. debug=true attaches the web inspector and unlocks screenshot / console / JS-eval tools.",
        inputSchema: {
          device: z.string(),
          appId: z.string(),
          debug: z.boolean().default(true),
        },
      },
      async ({ device: name, appId, debug }) => {
        const device = registry.get(name);
        const result = await registry.driverFor(device).launch(device, appId, debug);
        if (result.cdpUrl) {
          await cdp.attach(result.cdpUrl);
          enableTier(tier2); // progressive disclosure: debug tools appear now
          return text(
            `Launched ${appId} on ${device.name} with inspector attached.\n` +
              `Debug tools now available: screenshot, console_logs, eval_js.`,
          );
        }
        return text(`Launched ${appId} on ${device.name} (no debug session).`);
      },
    ),

    server.registerTool(
      "stop_app",
      { title: "Stop app", description: "Stop a running app.", inputSchema: { device: z.string(), appId: z.string() } },
      async ({ device: name, appId }) => {
        const device = registry.get(name);
        await registry.driverFor(device).stop(device, appId);
        await cdp.detach();
        return text(`Stopped ${appId} on ${device.name}.`);
      },
    ),

    server.registerTool(
      "uninstall_app",
      { title: "Uninstall app", description: "Remove an app from a TV.", inputSchema: { device: z.string(), appId: z.string() } },
      async ({ device: name, appId }) => {
        const device = registry.get(name);
        await registry.driverFor(device).uninstall(device, appId);
        return text(`Uninstalled ${appId} from ${device.name}.`);
      },
    ),

    server.registerTool(
      "device_logs",
      {
        title: "Platform logs",
        description: "Tail platform-level logs (sdb dlog / ares-log). For in-app JS logs use console_logs.",
        inputSchema: { device: z.string(), lines: z.number().int().min(1).max(500).default(100) },
      },
      async ({ device: name, lines }) => {
        const device = registry.get(name);
        const entries = await registry.driverFor(device).logs(device, lines);
        return text(entries.map((e) => e.message).join("\n") || "(no log output)");
      },
    ),

    server.registerTool(
      "remote_key",
      {
        title: "Press remote key",
        description:
          "Inject a remote-control key press (navigation testing). First call per TV triggers a one-time on-screen pairing prompt — see docs topic remote-key-pairing.",
        inputSchema: {
          device: z.string(),
          key: z.enum(REMOTE_KEYS),
          repeat: z.number().int().min(1).max(20).default(1),
        },
      },
      async ({ device: name, key, repeat }) => {
        const device = registry.get(name);
        const driver = registry.driverFor(device);
        for (let i = 0; i < repeat; i++) {
          await driver.sendKey(device, key as RemoteKey);
        }
        return text(`Sent ${key} x${repeat} to ${device.name}.`);
      },
    ),
  );

  // ---------- Tier 2: CDP debug plane (enabled on debug launch) ----------

  tier2.push(
    server.registerTool(
      "screenshot",
      {
        title: "Screenshot",
        description: "PNG screenshot of the running app's webview (via Chrome DevTools Protocol).",
        inputSchema: {},
      },
      async () => ({
        content: [{ type: "image" as const, data: await cdp.screenshot(), mimeType: "image/png" }],
      }),
    ),

    server.registerTool(
      "console_logs",
      {
        title: "JS console",
        description: "In-app JavaScript console output and uncaught exceptions since the debug launch.",
        inputSchema: { lines: z.number().int().min(1).max(500).default(50) },
      },
      async ({ lines }) =>
        text(
          cdp
            .consoleLogs(lines)
            .map((e) => `[${e.level}] ${e.message}`)
            .join("\n") || "(console empty)",
        ),
    ),

    server.registerTool(
      "eval_js",
      {
        title: "Evaluate JS",
        description:
          "Evaluate a JavaScript expression in the app context. Inspect state, force routes, or dispatch synthetic key events.",
        inputSchema: { expression: z.string() },
      },
      async ({ expression }) => text(await cdp.evaluate(expression)),
    ),
  );

  // Start hidden — this is the whole point.
  for (const t of [...tier1, ...tier2]) t.disable();

  return server;
}
