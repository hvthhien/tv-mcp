import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TokenStore } from "../state.js";
import { SAMSUNG_KEYS } from "./samsung.js";
import { WEBOS_BUTTONS } from "./ssap.js";

const ALL_KEYS = Object.keys(SAMSUNG_KEYS);

describe("key maps", () => {
  it("cover the same RemoteKey set on both platforms", () => {
    expect(Object.keys(WEBOS_BUTTONS).sort()).toEqual(ALL_KEYS.sort());
  });

  it("map to vendor-prefixed codes", () => {
    for (const code of Object.values(SAMSUNG_KEYS)) {
      expect(code).toMatch(/^KEY_[A-Z0-9]+$/);
    }
    for (const name of Object.values(WEBOS_BUTTONS)) {
      expect(name).toMatch(/^[A-Z]+$/);
    }
  });
});

describe("TokenStore", () => {
  it("persists and reloads secrets per namespace and device", () => {
    const path = join(mkdtempSync(join(tmpdir(), "tvmcp-state-")), "state.json");
    const store = new TokenStore(path);
    expect(store.get("samsung-tokens", "tv1")).toBeUndefined();

    store.set("samsung-tokens", "tv1", "tok-123");
    store.set("lg-client-keys", "tv2", "key-456");

    const reloaded = new TokenStore(path);
    expect(reloaded.get("samsung-tokens", "tv1")).toBe("tok-123");
    expect(reloaded.get("lg-client-keys", "tv2")).toBe("key-456");
    expect(reloaded.get("lg-client-keys", "tv1")).toBeUndefined();
  });
});
