import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

describe("loadConfig", () => {
  it("returns empty config when file is missing", () => {
    const cfg = loadConfig(join(tmpdir(), "does-not-exist.yaml"));
    expect(cfg.devices).toEqual([]);
    expect(cfg.projects).toEqual({});
  });

  it("parses devices and projects", () => {
    const dir = mkdtempSync(join(tmpdir(), "tvmcp-"));
    const path = join(dir, "devices.yaml");
    writeFileSync(
      path,
      `devices:
  - name: tv1
    platform: tizen
    host: 10.0.0.5
projects:
  app:
    buildCmd: npm run build
    dist: dist/
    webos: { appId: com.example.app }
`,
    );
    const cfg = loadConfig(path);
    expect(cfg.devices[0]).toMatchObject({ name: "tv1", platform: "tizen" });
    expect(cfg.projects.app.name).toBe("app");
  });
});

describe("buildServer", () => {
  it("constructs with an empty config", () => {
    expect(() => buildServer({ devices: [], projects: {} })).not.toThrow();
  });
});

describe("devModeResetUrl", () => {
  it("encodes the token into LG's reset endpoint", async () => {
    const { devModeResetUrl } = await import("./drivers/webos.js");
    expect(devModeResetUrl("abc+123=/x")).toBe(
      "https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken=abc%2B123%3D%2Fx",
    );
  });
});
