import type { Device, DeviceConfig, Platform, TVDriver } from "./types.js";
import { TVMcpError } from "./types.js";

/**
 * Tracks configured + connected devices and routes calls to the right driver.
 * Also the source of truth for progressive disclosure: the server asks
 * `connectedPlatforms()` to decide which tool tiers to enable.
 */
export class DeviceRegistry {
  private devices = new Map<string, Device>();

  constructor(
    private readonly drivers: Record<Platform, TVDriver>,
    configured: DeviceConfig[],
  ) {
    for (const c of configured) {
      this.devices.set(c.name, { ...c, reachable: false });
    }
  }

  list(): Device[] {
    return [...this.devices.values()];
  }

  get(name: string): Device {
    const d = this.devices.get(name);
    if (!d) {
      const known = [...this.devices.keys()].join(", ") || "(none)";
      throw new TVMcpError(
        `Unknown device '${name}'.`,
        `Known devices: ${known}. Add it to devices.yaml or call connect_device with a host.`,
      );
    }
    return d;
  }

  driverFor(device: Device): TVDriver {
    return this.drivers[device.platform];
  }

  async connect(config: DeviceConfig): Promise<Device> {
    const device = await this.drivers[config.platform].connect(config);
    this.devices.set(device.name, device);
    return device;
  }

  /** Platforms with at least one reachable device — drives tool-tier enablement. */
  connectedPlatforms(): Set<Platform> {
    const platforms = new Set<Platform>();
    for (const d of this.devices.values()) {
      if (d.reachable) platforms.add(d.platform);
    }
    return platforms;
  }
}
