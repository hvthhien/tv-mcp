import { networkInterfaces } from "node:os";
import { TVMcpError } from "../types.js";

/**
 * Client for LG's RMS (Remote Management System) REST API on hospitality
 * panels — the external face of HCAP's `hcap.rms`, served on TCP port 10000.
 *
 * Why this matters: it needs NO Dev Mode, NO ares, NO LG developer account —
 * just HTTP once the requestor IP is authorized. On Pro:Centric hotel panels
 * that don't expose the consumer dev flow, this may be the ONLY programmatic
 * path. Access is an IP allowlist: authorize this machine's IP against the
 * TV's IP, then call the internal API.
 *
 * Shape observed directly from a 50UR762H3ZC's own /doc/index.html
 * (2026-08-04); untested against a reachable panel. Endpoints beyond
 * /api/authorize are added as the live doc is confirmed.
 */
export class RmsClient {
  private authorized = false;

  constructor(
    private readonly deviceIp: string,
    private readonly port = 10000,
    /** Requestor IP; auto-detected on the TV's subnet when omitted. */
    private readonly requestorIp?: string,
  ) {}

  private base(): string {
    return `http://${this.deviceIp}:${this.port}`;
  }

  /** This machine's IPv4 on the same /24 as the TV (best-effort). */
  private detectRequestorIp(): string {
    if (this.requestorIp) return this.requestorIp;
    const prefix = this.deviceIp.split(".").slice(0, 3).join(".") + ".";
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === "IPv4" && !a.internal && a.address.startsWith(prefix)) {
          return a.address;
        }
      }
    }
    throw new TVMcpError(
      `No local IPv4 on the TV's subnet (${prefix}0/24) to authorize.`,
      "Put this machine on the same subnet as the TV, or pass requestorIp explicitly.",
    );
  }

  private async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(this.base() + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch((err) => {
      throw new TVMcpError(
        `RMS request to ${url.pathname} failed: ${(err as Error).message}`,
        "Confirm the TV is on and reachable, RMS is enabled on the panel, and port 10000 is open (older models may not provide RMS).",
      );
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      throw new TVMcpError(`RMS ${path} returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return body;
  }

  /**
   * IP-allowlist handshake: authorize this machine to use the TV's internal
   * HCAP API. Must succeed before other calls.
   */
  async authorize(): Promise<unknown> {
    const requestorIpAddress = this.detectRequestorIp();
    const result = await this.get("/api/authorize", {
      deviceIpAddress: this.deviceIp,
      requestorIpAddress,
    });
    this.authorized = true;
    return result;
  }

  /** Fetch the raw API doc/spec (Swagger/OpenAPI JSON if the panel serves it). */
  async fetchApiDoc(): Promise<unknown> {
    return this.get("/doc/index.html").catch(() => this.get("/api-docs"));
  }

  private ensureAuthorized(): void {
    if (!this.authorized) {
      throw new TVMcpError("RMS call before authorize().", "Call authorize() first.");
    }
  }

  /**
   * Placeholder for the read-only device/playback status call — the DOM-free
   * "what's playing / is it playing" path for VOD/ad verification. Exact
   * endpoint TBD from the live doc; wired once confirmed on hardware.
   */
  async status(): Promise<unknown> {
    this.ensureAuthorized();
    throw new TVMcpError(
      "RMS status endpoint not yet mapped.",
      "Capture the media/status endpoint from the panel's /doc/index.html and wire it here.",
    );
  }
}
