import { describe, expect, it } from "vitest";
import { classifyProfile, parseProfilesXml } from "./doctor.js";

describe("classifyProfile", () => {
  it("recognizes Samsung-issued certs by SamsungCertificate path", () => {
    expect(classifyProfile("/Users/x/SamsungCertificate/my-prof/distributor.p12")).toBe("samsung");
  });

  it("recognizes the generic SDK distributor cert", () => {
    expect(
      classifyProfile(
        "/x/tools/certificate-generator/certificates/distributor/sdk-partner/tizen-distributor-signer-new.p12",
      ),
    ).toBe("generic");
  });

  it("returns unknown otherwise", () => {
    expect(classifyProfile("/somewhere/custom.p12")).toBe("unknown");
  });
});

describe("parseProfilesXml", () => {
  const xml = `<?xml version="1.0"?>
<profiles version="3.1">
  <profile name="dev-generic">
    <profileitem ca="" distributor="0" key="/keystore/author/dev_auth.p12" password="x" rootca=""/>
    <profileitem ca="" distributor="1" key="/tools/certificate-generator/certificates/distributor/tizen-distributor-signer-new.p12" password="x" rootca=""/>
    <profileitem ca="" distributor="2" key="" password="" rootca=""/>
  </profile>
  <profile name="dev-samsung">
    <profileitem ca="" distributor="0" key="/Users/x/SamsungCertificate/dev-samsung/author.p12" password="x" rootca=""/>
    <profileitem ca="" distributor="1" key="/Users/x/SamsungCertificate/dev-samsung/distributor.p12" password="x" rootca=""/>
    <profileitem ca="" distributor="2" key="" password="" rootca=""/>
  </profile>
</profiles>`;

  it("extracts each profile with its distributor key", () => {
    const profiles = parseProfilesXml(xml);
    expect(profiles).toHaveLength(2);
    expect(profiles[0].name).toBe("dev-generic");
    expect(classifyProfile(profiles[0].distributorKey)).toBe("generic");
    expect(profiles[1].name).toBe("dev-samsung");
    expect(classifyProfile(profiles[1].distributorKey)).toBe("samsung");
  });
});
