import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Upgrades from "../src/app/upgrades/page";

const v = { version: "0.6.0", network: "bradbury-phase2", mandatory: true, breaking: true, deadline: "2026-11-01T00:00:00Z",
  config_changes: ["genvm.root_dir"], env_changes: [], actions: ["Upgrade before the deadline"], source_url: "https://docs.genlayer.com/validators/changelog", firstSeenAt: 1 };
const old = { ...v, version: "0.5.14", mandatory: false, breaking: false, deadline: null, config_changes: [], actions: [] };
afterEach(() => vi.unstubAllGlobals());
const mock = (body: unknown, status = 200) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }));

describe("upgrades tab", () => {
  it("shows the current verdict with flags, keys, actions, contract link and history", async () => {
    mock({ enabled: true, contract: "0x0D81c42a86eF913e1Eb6c34DE02c5608C31961Cc", network: "bradbury-phase2", latest: v, history: [v, old], checkedAt: 1, error: null });
    const html = renderToStaticMarkup(await Upgrades());
    for (const s of ["v0.6.0", "Mandatory upgrade", "Breaking", "Deadline 2026-11-01T00:00:00Z", "genvm.root_dir", "Upgrade before the deadline", "v0.5.14",
      "https://explorer-bradbury.genlayer.com/address/0x0D81c42a86eF913e1Eb6c34DE02c5608C31961Cc", "None in this release."]) expect(html).toContain(s);
  });
  it("says when upgrades are not configured", async () => {
    mock({ enabled: false, contract: null, network: null, latest: null, history: [], checkedAt: null, error: null });
    expect(renderToStaticMarkup(await Upgrades())).toContain("not configured");
  });
});
