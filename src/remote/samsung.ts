import WebSocket from "ws";
import type { RemoteKey } from "../types.js";
import { TVMcpError } from "../types.js";
import type { TokenStore } from "../state.js";

/** RemoteKey → Samsung KEY_* codes. */
export const SAMSUNG_KEYS: Record<RemoteKey, string> = {
  UP: "KEY_UP",
  DOWN: "KEY_DOWN",
  LEFT: "KEY_LEFT",
  RIGHT: "KEY_RIGHT",
  OK: "KEY_ENTER",
  BACK: "KEY_RETURN",
  HOME: "KEY_HOME",
  PLAY: "KEY_PLAY",
  PAUSE: "KEY_PAUSE",
  STOP: "KEY_STOP",
  REWIND: "KEY_REWIND",
  FAST_FORWARD: "KEY_FF",
  VOLUME_UP: "KEY_VOLUP",
  VOLUME_DOWN: "KEY_VOLDOWN",
  MUTE: "KEY_MUTE",
  CHANNEL_UP: "KEY_CHUP",
  CHANNEL_DOWN: "KEY_CHDOWN",
  RED: "KEY_RED",
  GREEN: "KEY_GREEN",
  YELLOW: "KEY_YELLOW",
  BLUE: "KEY_BLUE",
  EXIT: "KEY_EXIT",
};

const APP_NAME = Buffer.from("tv-mcp").toString("base64");
const PAIRING_TIMEOUT_MS = 60_000;

/**
 * Samsung remote-control client (Tizen TVs, 2016+).
 *
 * Protocol: wss://<tv>:8002/api/v2/channels/samsung.remote.control
 * First connect without a token makes the TV show an allow/deny prompt;
 * the ms.channel.connect event then carries a token we persist per device.
 * Subsequent connects pass the token and skip the prompt.
 */
export class SamsungRemote {
  private ws: WebSocket | null = null;

  constructor(
    private readonly host: string,
    private readonly deviceName: string,
    private readonly store: TokenStore,
  ) {}

  async sendKey(key: RemoteKey): Promise<void> {
    const ws = await this.connect();
    ws.send(
      JSON.stringify({
        method: "ms.remote.control",
        params: {
          Cmd: "Click",
          DataOfCmd: SAMSUNG_KEYS[key],
          Option: "false",
          TypeOfRemote: "SendRemoteKey",
        },
      }),
    );
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  private async connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return this.ws;

    const token = this.store.get("samsung-tokens", this.deviceName);
    const url =
      `wss://${this.host}:8002/api/v2/channels/samsung.remote.control` +
      `?name=${APP_NAME}${token ? `&token=${token}` : ""}`;

    // TVs serve a self-signed certificate on 8002; there is no CA to pin.
    // Trust is established by the on-screen pairing prompt instead.
    const ws = new WebSocket(url, { rejectUnauthorized: false });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.terminate();
        reject(
          new TVMcpError(
            `Samsung TV at ${this.host} did not accept the remote connection within ${PAIRING_TIMEOUT_MS / 1000}s.`,
            token
              ? "Saved token may have been revoked (TV reset?). Delete it from ~/.tv-mcp/state.json and retry to re-pair."
              : "A pairing prompt should be showing on the TV — approve it with the physical remote, then retry.",
          ),
        );
      }, PAIRING_TIMEOUT_MS);

      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.event === "ms.channel.connect") {
          const grantedToken: string | undefined = msg.data?.token;
          if (grantedToken) {
            this.store.set("samsung-tokens", this.deviceName, grantedToken);
          }
          clearTimeout(timer);
          resolve();
        } else if (msg.event === "ms.channel.unauthorized") {
          clearTimeout(timer);
          ws.terminate();
          reject(
            new TVMcpError(
              `Samsung TV at ${this.host} denied the pairing request.`,
              "Retry and choose Allow on the TV prompt. If no prompt appears: TV menu → General → External Device Manager → Device Connection Manager → allow this device.",
            ),
          );
        }
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(
          new TVMcpError(
            `Remote websocket to ${this.host}:8002 failed: ${err.message}`,
            "Port 8002 is only open when the TV is on (not standby) and on the same network. Older models (<2016) use a different protocol and are unsupported.",
          ),
        );
      });
    });

    this.ws = ws;
    return ws;
  }
}
