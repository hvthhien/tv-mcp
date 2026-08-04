/**
 * Core domain types shared across drivers, the CDP bridge, and the server.
 */

export type Platform = "tizen" | "webos";

/** Remote-control keys, normalized across vendors. Drivers map to platform codes. */
export type RemoteKey =
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "OK"
  | "BACK"
  | "HOME"
  | "PLAY"
  | "PAUSE"
  | "STOP"
  | "REWIND"
  | "FAST_FORWARD"
  | "VOLUME_UP"
  | "VOLUME_DOWN"
  | "MUTE"
  | "CHANNEL_UP"
  | "CHANNEL_DOWN"
  | "RED"
  | "GREEN"
  | "YELLOW"
  | "BLUE"
  | "EXIT";

export interface DeviceConfig {
  name: string;
  platform: Platform;
  host: string;
  /** Tizen: name of the certificate profile to sign with. */
  signingProfile?: string;
  /** webOS: env var holding the ares device passphrase. Never store the value itself. */
  passphraseEnv?: string;
}

export interface Device extends DeviceConfig {
  /** Populated after connect(): sdb serial or ares device name. */
  serial?: string;
  reachable: boolean;
}

export interface ProjectConfig {
  name: string;
  /** Command that produces the web build, e.g. "npm run build". */
  buildCmd: string;
  /** Directory the web build emits, packaged as-is into .wgt/.ipk. */
  dist: string;
  tizen?: { appId: string; profile: string };
  webos?: { appId: string };
}

export interface Artifact {
  platform: Platform;
  path: string;
  appId: string;
}

export interface LaunchResult {
  appId: string;
  /**
   * Chrome DevTools Protocol websocket URL for the app's webview,
   * present when launched in debug mode. Feed to CdpBridge.
   */
  cdpUrl?: string;
}

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  source: "platform" | "console";
  message: string;
}

/**
 * The per-vendor abstraction. TizenDriver wraps the `tizen`/`sdb` CLIs,
 * WebOSDriver wraps the `ares-*` CLIs. Everything above this interface
 * is platform-agnostic.
 */
export interface TVDriver {
  readonly platform: Platform;

  /** Devices this driver's tooling can currently see (sdb devices / ares-setup-device --list). */
  listDevices(): Promise<Device[]>;

  /** Establish a connection to a TV by host. Idempotent. */
  connect(config: DeviceConfig): Promise<Device>;

  /** Package a completed web build into a platform artifact (.wgt / .ipk). */
  package(project: ProjectConfig, webBuildDir: string): Promise<Artifact>;

  install(device: Device, artifact: Artifact): Promise<void>;

  /** Launch the app; debug=true attaches the web inspector and returns a CDP URL. */
  launch(device: Device, appId: string, debug: boolean): Promise<LaunchResult>;

  stop(device: Device, appId: string): Promise<void>;

  uninstall(device: Device, appId: string): Promise<void>;

  sendKey(device: Device, key: RemoteKey): Promise<void>;

  /** Tail platform logs (sdb dlog / ares-log). */
  logs(device: Device, lines: number): Promise<LogEntry[]>;

  /**
   * Platform-specific session keep-alive (webOS Dev Mode). Drivers without
   * the concept leave it undefined.
   */
  renewDevMode?(device: Device): Promise<string>;
}

/** Structured, agent-actionable error. Message must say what to DO, not just what broke. */
export class TVMcpError extends Error {
  constructor(
    message: string,
    public readonly remedy?: string,
  ) {
    super(remedy ? `${message}\nRemedy: ${remedy}` : message);
    this.name = "TVMcpError";
  }
}
