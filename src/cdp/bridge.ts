import CDP from "chrome-remote-interface";
import type { LogEntry } from "../types.js";
import { TVMcpError } from "../types.js";

/**
 * Chrome DevTools Protocol bridge — the platform-agnostic debug plane.
 *
 * Both Tizen and webOS apps are web apps running in a Chromium-based webview
 * that exposes a remote inspector. Once a driver's launch() returns a cdpUrl,
 * everything here (screenshots, console, JS eval) works identically on both.
 */
export class CdpBridge {
  private client: CDP.Client | null = null;
  private consoleBuffer: LogEntry[] = [];
  private static readonly MAX_BUFFER = 2000;

  async attach(cdpUrl: string): Promise<void> {
    await this.detach();
    try {
      this.client = await CDP({ target: cdpUrl });
    } catch (err) {
      throw new TVMcpError(
        `Could not attach to inspector at ${cdpUrl}: ${(err as Error).message}`,
        "Relaunch the app with debug=true; the inspector socket dies when the app restarts.",
      );
    }
    const { Runtime, Page, Log } = this.client;
    await Promise.all([Runtime.enable(), Page.enable(), Log.enable()]);

    Runtime.consoleAPICalled(({ type, args, timestamp }) => {
      this.push({
        timestamp: new Date(timestamp).toISOString(),
        level: type === "error" ? "error" : type === "warning" ? "warn" : "info",
        source: "console",
        message: args.map((a) => a.value ?? a.description ?? "").join(" "),
      });
    });

    Runtime.exceptionThrown(({ exceptionDetails, timestamp }) => {
      this.push({
        timestamp: new Date(timestamp).toISOString(),
        level: "error",
        source: "console",
        message:
          exceptionDetails.exception?.description ?? exceptionDetails.text,
      });
    });
  }

  get attached(): boolean {
    return this.client !== null;
  }

  /** PNG screenshot of the app's webview, base64-encoded. */
  async screenshot(): Promise<string> {
    const { data } = await this.require().Page.captureScreenshot({
      format: "png",
    });
    return data;
  }

  /** Evaluate JS in the app context; returns the JSON-serialized result. */
  async evaluate(expression: string): Promise<string> {
    const { result, exceptionDetails } = await this.require().Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      return `EXCEPTION: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`;
    }
    return JSON.stringify(result.value ?? result.description ?? null, null, 2);
  }

  consoleLogs(lines: number): LogEntry[] {
    return this.consoleBuffer.slice(-lines);
  }

  async detach(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
    this.consoleBuffer = [];
  }

  private push(entry: LogEntry): void {
    this.consoleBuffer.push(entry);
    if (this.consoleBuffer.length > CdpBridge.MAX_BUFFER) {
      this.consoleBuffer.shift();
    }
  }

  private require(): CDP.Client {
    if (!this.client) {
      throw new TVMcpError(
        "No inspector session.",
        "Call launch_app with debug=true first.",
      );
    }
    return this.client;
  }
}
