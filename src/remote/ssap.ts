import WebSocket from "ws";
import type { RemoteKey } from "../types.js";
import { TVMcpError } from "../types.js";
import type { TokenStore } from "../state.js";

/** RemoteKey → webOS pointer-input-socket button names. */
export const WEBOS_BUTTONS: Record<RemoteKey, string> = {
  UP: "UP",
  DOWN: "DOWN",
  LEFT: "LEFT",
  RIGHT: "RIGHT",
  OK: "ENTER",
  BACK: "BACK",
  HOME: "HOME",
  PLAY: "PLAY",
  PAUSE: "PAUSE",
  STOP: "STOP",
  REWIND: "REWIND",
  FAST_FORWARD: "FASTFORWARD",
  VOLUME_UP: "VOLUMEUP",
  VOLUME_DOWN: "VOLUMEDOWN",
  MUTE: "MUTE",
  CHANNEL_UP: "CHANNELUP",
  CHANNEL_DOWN: "CHANNELDOWN",
  RED: "RED",
  GREEN: "GREEN",
  YELLOW: "YELLOW",
  BLUE: "BLUE",
  EXIT: "EXIT",
};

const PAIRING_TIMEOUT_MS = 60_000;

/**
 * Permission manifest sent with the SSAP register call. The TV shows the
 * pairing prompt on first registration; the response carries a client-key
 * that skips the prompt on subsequent connects.
 */
const MANIFEST = {
  manifestVersion: 1,
  permissions: [
    "LAUNCH",
    "LAUNCH_WEBAPP",
    "CONTROL_AUDIO",
    "CONTROL_INPUT_MEDIA_PLAYBACK",
    "CONTROL_INPUT_TV",
    "CONTROL_POWER",
    "READ_INPUT_DEVICE_LIST",
    "READ_CURRENT_CHANNEL",
    "READ_RUNNING_APPS",
    "CONTROL_INPUT_JOYSTICK",
    "CONTROL_INPUT_TEXT",
    "CONTROL_MOUSE_AND_KEYBOARD",
  ],
};

/**
 * LG webOS SSAP client.
 *
 * Main channel: wss://<tv>:3001 (2022+ firmware) with ws://<tv>:3000 fallback.
 * Key presses go over a second socket obtained via
 * ssap://com.webos.service.networkinput/getPointerInputSocket, as
 * newline-delimited "type:button\nname:<BUTTON>\n\n" frames.
 */
export class LgRemote {
  private ws: WebSocket | null = null;
  private inputWs: WebSocket | null = null;
  private nextId = 0;

  constructor(
    private readonly host: string,
    private readonly deviceName: string,
    private readonly store: TokenStore,
  ) {}

  async sendKey(key: RemoteKey): Promise<void> {
    const input = await this.inputSocket();
    input.send(`type:button\nname:${WEBOS_BUTTONS[key]}\n\n`);
  }

  close(): void {
    this.inputWs?.close();
    this.ws?.close();
    this.inputWs = null;
    this.ws = null;
  }

  private async connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return this.ws;
    // Self-signed cert on 3001, same trust model as Samsung: the on-screen
    // pairing prompt is the trust anchor, not the TLS chain.
    const ws = await this.open(`wss://${this.host}:3001`).catch(() =>
      this.open(`ws://${this.host}:3000`),
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.terminate();
        reject(
          new TVMcpError(
            `LG TV at ${this.host} did not complete SSAP registration within ${PAIRING_TIMEOUT_MS / 1000}s.`,
            "A pairing prompt should be showing on the TV — accept it, then retry. If a saved client-key stopped working (TV reset), delete it from ~/.tv-mcp/state.json.",
          ),
        );
      }, PAIRING_TIMEOUT_MS);

      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "registered") {
          const clientKey: string | undefined = msg.payload?.["client-key"];
          if (clientKey) this.store.set("lg-client-keys", this.deviceName, clientKey);
          clearTimeout(timer);
          resolve();
        } else if (msg.type === "error") {
          clearTimeout(timer);
          ws.terminate();
          reject(
            new TVMcpError(
              `SSAP registration rejected by ${this.host}: ${msg.error}`,
              "Retry and accept the prompt on the TV.",
            ),
          );
        }
        // type === "response" with pairingType PROMPT means the prompt is
        // on screen; keep waiting for "registered".
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(
          new TVMcpError(
            `SSAP websocket to ${this.host} failed: ${err.message}`,
            "TV must be on (not standby) and on the same network. Ports: 3001 (wss) or 3000 (ws).",
          ),
        );
      });

      ws.send(
        JSON.stringify({
          type: "register",
          id: `register_${this.nextId++}`,
          payload: {
            manifest: MANIFEST,
            "client-key": this.store.get("lg-client-keys", this.deviceName),
          },
        }),
      );
    });

    this.ws = ws;
    return ws;
  }

  private async inputSocket(): Promise<WebSocket> {
    if (this.inputWs?.readyState === WebSocket.OPEN) return this.inputWs;
    const ws = await this.connect();

    const socketPath = await new Promise<string>((resolve, reject) => {
      const id = `input_${this.nextId++}`;
      const timer = setTimeout(
        () => reject(new TVMcpError("getPointerInputSocket timed out.")),
        15_000,
      );
      const onMessage = (raw: WebSocket.RawData) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id !== id) return;
        ws.off("message", onMessage);
        clearTimeout(timer);
        if (msg.type === "response" && msg.payload?.socketPath) {
          resolve(msg.payload.socketPath);
        } else {
          reject(
            new TVMcpError(
              `getPointerInputSocket failed: ${JSON.stringify(msg.payload ?? msg.error)}`,
            ),
          );
        }
      };
      ws.on("message", onMessage);
      ws.send(
        JSON.stringify({
          type: "request",
          id,
          uri: "ssap://com.webos.service.networkinput/getPointerInputSocket",
        }),
      );
    });

    this.inputWs = await this.open(socketPath);
    return this.inputWs;
  }

  private open(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { rejectUnauthorized: false });
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  }
}
