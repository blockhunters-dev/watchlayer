import { describe, it, expect } from "vitest";
import { githubUrl, normalizeIdentity, safeUrl } from "../src/derive.js";

describe("identity normalization", () => {
  it("accepts only http(s) URLs and maps ipfs to a gateway", () => {
    expect(safeUrl("https://example.org/a")).toBe("https://example.org/a");
    expect(safeUrl("http://example.org")).toBe("http://example.org/");
    expect(safeUrl("ipfs://bafyabc/logo.png")).toBe("https://ipfs.io/ipfs/bafyabc/logo.png");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>")).toBeNull();
    expect(safeUrl("file:///etc/passwd")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });
  it("turns GitHub handles into profile URLs", () => {
    expect(githubUrl("blockhunters")).toBe("https://github.com/blockhunters");
    expect(githubUrl("@block-hunters")).toBe("https://github.com/block-hunters");
    expect(githubUrl("https://github.com/org/repo")).toBe("https://github.com/org/repo");
    expect(githubUrl("javascript:1")).toBeNull();
    expect(githubUrl("bad handle!")).toBeNull();
  });
  it("normalizes a full identity and tolerates missing data", () => {
    expect(normalizeIdentity({ moniker: "  BH  ", logoUri: "ipfs://bafy", website: "https://x.io", github: "bh" }))
      .toEqual({ moniker: "BH", logo: "https://ipfs.io/ipfs/bafy", website: "https://x.io/", github: "https://github.com/bh" });
    expect(normalizeIdentity(undefined)).toEqual({ moniker: null, logo: null, website: null, github: null });
  });
});
