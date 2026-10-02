import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAppId, assertArtifactPath, assertHost, parseCommand } from "./validate.js";

describe("parseCommand", () => {
  it("splits plain commands and quotes", () => {
    expect(parseCommand("npm run build")).toEqual(["npm", "run", "build"]);
    expect(parseCommand(`node -e "a b"`)).toEqual(["node", "-e", "a b"]);
  });
  it("accepts argv arrays", () => {
    expect(parseCommand(["npm", "run", "build"])).toEqual(["npm", "run", "build"]);
  });
  it.each(["npm run build; rm -rf ~", "a && b", "a | b", "echo $HOME", "a `b`", "a > f"])(
    "rejects shell syntax: %s",
    (c) => expect(() => parseCommand(c)).toThrow(/shell syntax/),
  );
});

describe("assertAppId", () => {
  it("accepts tizen and webos ids", () => {
    expect(assertAppId("ABCDvxyz12.myapp")).toBeTruthy();
    expect(assertAppId("com.example.app")).toBeTruthy();
  });
  it.each(["--remove", "-x", "a b", "a;b", "../x", ""])("rejects %j", (id) =>
    expect(() => assertAppId(id)).toThrow(),
  );
});

describe("assertHost", () => {
  it.each(["192.168.1.4", "192.168.1.4:26101", "tv.local", "fe80::1"])("accepts %s", (h) =>
    expect(assertHost(h)).toBe(h),
  );
  it.each(['1.2.3.4","username":"root', "-oProxy", "a b", ""])("rejects %j", (h) =>
    expect(() => assertHost(h)).toThrow(),
  );
});

describe("assertArtifactPath", () => {
  it("allows packages under allowed roots and the tv-mcp temp dir", () => {
    expect(assertArtifactPath("/proj/dist/app.wgt", ["/proj/dist"])).toBe("/proj/dist/app.wgt");
    expect(assertArtifactPath(join(tmpdir(), "tv-mcp-ipk", "a.ipk"), [])).toBeTruthy();
  });
  it("rejects other extensions, traversal and outside paths", () => {
    expect(() => assertArtifactPath("/proj/dist/a.sh", ["/proj/dist"])).toThrow();
    expect(() => assertArtifactPath("/proj/dist/../../etc/x.wgt", ["/proj/dist"])).toThrow();
    expect(() => assertArtifactPath("/etc/x.wgt", ["/proj/dist"])).toThrow();
  });
});
