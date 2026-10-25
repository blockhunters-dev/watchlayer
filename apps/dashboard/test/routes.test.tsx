import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../src/app/page";
import Validators from "../src/app/validators/page";
import Bans from "../src/app/bans/page";
import Epochs from "../src/app/epochs/page";
import Alerts from "../src/app/alerts/page";
import ValidatorPage from "../src/app/validators/[address]/page";
import type { Network, Validator, ValidatorPoint } from "../src/lib/api";

const ADDR = "0x42b7bb7CDD228AeCEf96cbDaa5c94Ebc6A65635f";
const GEN = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const now = Math.floor(Date.now() / 1000);

const net: Network = {
  epoch: "2", nextEpochEstimate: now + 3600, snapshotAt: now - 120, totalStake: GEN(4_037_701), txPerHour: 234, avgBlockSeconds: 119.4,
  rpc: { uptime24h: 0.985, runs24h: 200, lastSuccessAt: 1, snapshotDurationMs: 61_000, avgSnapshotDurationMs: 60_000 },
  validators: { total: 2, active: 1, pending: 1, banned: 0, needsPriming: 0 },
};
const mine: Validator = {
  address: ADDR, operator: "0x830Bf1B10B2153324094e302B25FD0f4565d185A", moniker: "BlockHunters",
  identity: { moniker: "BlockHunters", logo: "https://ipfs.io/ipfs/bafyX", website: "https://blockhunters.org/", github: "https://github.com/blockhunters" },
  status: "pending", vStake: "0", dStake: "0",
  pendingDeposits: [
    { epoch: "2", stakeRaw: GEN(50_000), activatesAtEpoch: "4", stillPending: true },
    { epoch: "0", stakeRaw: GEN(7), activatesAtEpoch: "2", stillPending: false },
  ],
  operatorBalanceWei: GEN(100), gasRunwayDays: 0.5, pendingWithdrawals: [{ epoch: "1", stakeRaw: GEN(3) }], firstSeenAt: now - 7200, bans: [], lastBannedAt: null,
  strikes: null, ban: null, snapshotAt: now,
  activity: { lastTxAt: null, txLast24h: 0, silentHours: 1.5 },
};
const banned: Validator = { ...mine, address: "0x2222222222222222222222222222222222222222", moniker: "Zed", status: "banned", vStake: GEN(9),
  identity: { moniker: "Zed", logo: null, website: null, github: null }, ban: { untilEpoch: "4", permanent: false }, pendingDeposits: [],
  bans: [{ untilEpoch: "4", permanent: false, firstSeenAt: now - 600, lastSeenAt: now - 60 }, { untilEpoch: "1", permanent: false, firstSeenAt: now - 7000, lastSeenAt: now - 6000 }] };
const other: Validator = { ...mine, address: "0x1111111111111111111111111111111111111111", moniker: "Alpha", status: "active",
  identity: { moniker: "Alpha", logo: null, website: null, github: null }, vStake: GEN(50_000), pendingDeposits: [], gasRunwayDays: 10 };
const big: Validator = { ...other, address: "0x3333333333333333333333333333333333333333", moniker: "Bravo", identity: { ...other.identity, moniker: "Bravo" }, vStake: GEN(150_000) };
const history: ValidatorPoint[] = [
  { t: 1, status: "pending", vStake: "0", dStake: "0", operatorBalanceWei: GEN(100), operatorNonce: 0 },
  { t: 2, status: "pending", vStake: "0", dStake: "0", operatorBalanceWei: GEN(99), operatorNonce: 1 },
];
const epochRow = { epoch: "2", t: 1, txPerHour: 5, totalStake: GEN(123), validators: net.validators };

/** Serve the documented API paths; anything else is a 404 so a wrong endpoint fails the test. */
function mockApi(routes: Record<string, unknown>) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    asked.push(path);
    return path in routes ? new Response(JSON.stringify(routes[path])) : new Response("{}", { status: 404 });
  });
  return asked;
}
afterEach(() => vi.unstubAllGlobals());
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });

describe("overview", () => {
  it("renders network stats, status split, concentration, top stake and current bans", async () => {
    const asked = mockApi({ "/network": net, "/validators": [other, mine, banned, big], "/network/epochs": [epochRow], "/network/history": [] });
    const html = renderToStaticMarkup(await Home());
    expect(asked.sort()).toEqual(["/network", "/network/epochs", "/network/history", "/validators"]);
    expect(html).toContain("4,037,701.00 GEN");
    expect(html).toContain(">234<");
    expect(html).toContain("119 s");
    expect(html).toContain("98.5%");
    expect(html).toContain("1 active · 1 pending");
    expect(html).toContain("validators hold &gt; 1/3 of stake");
    expect(html.indexOf("Bravo")).toBeLessThan(html.indexOf("Alpha")); // top 10 sorted by stake
    expect(html).toContain("Banned · until epoch 4");
    expect(html).toContain("Collecting data"); // one epoch only: chart waits for a second point
    expect(html).toContain("https://t.me/genlayer_watchtower_bot");
  });
  it("shows an empty state when the API has no snapshot", async () => {
    mockApi({});
    expect(renderToStaticMarkup(await Home())).toContain("No data yet");
  });
});

describe("validators tab", () => {
  it("lists identity, runway, still-pending deposits, rank and alert links; problems first", async () => {
    const asked = mockApi({ "/validators": [other, mine] });
    const html = renderToStaticMarkup(await Validators(sp()));
    expect(asked).toEqual(["/validators"]);
    expect(html).toContain(`href="/validators/${ADDR}"`);
    expect(html).toContain('src="https://ipfs.io/ipfs/bafyX"');
    expect(html).toContain("12 h"); // runway 0.5d
    expect(html).toContain("50,000.00 GEN"); // still-pending deposit
    expect(html).not.toContain("7.00 GEN"); // already-activated epoch-0 deposit is not shown as pending
    expect(html.indexOf("BlockHunters</strong>")).toBeLessThan(html.indexOf("Alpha</strong>")); // pending sorts before active
    expect(html).toContain(`https://t.me/genlayer_watchtower_bot?start=${ADDR}`);
    expect(html).toContain("100.00%"); // Alpha is the only active validator
  });
  it("filters by status, searches and sorts by stake", async () => {
    mockApi({ "/validators": [other, mine, big] });
    let html = renderToStaticMarkup(await Validators(sp({ status: "active" })));
    expect(html).toContain("Alpha"); expect(html).not.toContain("BlockHunters</strong>");
    html = renderToStaticMarkup(await Validators(sp({ q: "0x1111" })));
    expect(html).toContain("Alpha</strong>"); expect(html).not.toContain("Bravo</strong>");
    html = renderToStaticMarkup(await Validators(sp({ sort: "stake" })));
    expect(html.indexOf("Bravo</strong>")).toBeLessThan(html.indexOf("Alpha</strong>"));
    expect(html.indexOf("Alpha</strong>")).toBeLessThan(html.indexOf("BlockHunters</strong>"));
  });
});

describe("bans tab", () => {
  it("separates ongoing bans from history and counts repeat bans", async () => {
    mockApi({ "/network": net, "/validators": [other, banned] });
    const html = renderToStaticMarkup(await Bans());
    expect(html).toContain("Banned · until epoch 4");
    expect(html).toContain("Until epoch 1");
    expect(html).toContain(">Ongoing<");
    expect(html).toContain(">Ended<");
    expect(html).toContain("2 bans");
    expect(html).toContain("9.00 GEN");
  });
});

describe("epochs and alerts tabs", () => {
  it("renders the per-epoch table", async () => {
    mockApi({ "/network": net, "/network/epochs": [epochRow] });
    const html = renderToStaticMarkup(await Epochs());
    expect(html).toContain("Network by epoch");
    expect(html).toContain("123.00 GEN");
  });
  it("documents the bot commands", () => {
    const html = renderToStaticMarkup(Alerts());
    for (const c of ["/watch 0x…", "/list", "/status 0x…", "/unwatch 0x…"]) expect(html).toContain(c);
  });
});

describe("validator detail page", () => {
  it("renders identity links, stake, gas, activity and history from the validator endpoints", async () => {
    const asked = mockApi({ [`/validators/${ADDR}`]: mine, [`/validators/${ADDR}/history`]: history,
      [`/validators/${ADDR}/epochs`]: [{ epoch: "2", t: 1, status: "pending", vStake: "0", dStake: "0", operatorBalanceWei: GEN(100), operatorNonce: 0, operatorTx: null },
        { epoch: "3", t: 2, status: "pending", vStake: "0", dStake: "0", operatorBalanceWei: GEN(99), operatorNonce: 4, operatorTx: 4 }] });
    const html = renderToStaticMarkup(await ValidatorPage({ params: Promise.resolve({ address: ADDR }) }));
    expect(asked.sort()).toEqual([`/validators/${ADDR}`, `/validators/${ADDR}/epochs`, `/validators/${ADDR}/history`]);
    expect(html).toContain("By epoch");
    expect(html.indexOf("<td>3</td>")).toBeLessThan(html.indexOf("<td>2</td>")); // newest epoch first
    expect(html).toContain("BlockHunters");
    expect(html).toContain('href="https://blockhunters.org/"');
    expect(html).toContain('href="https://github.com/blockhunters"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain("active from epoch 4");
    expect(html).toContain("100.00 GEN");
    expect(html).toContain("Unavailable"); // strikes
    expect(html).toContain("3.00 GEN"); // pending withdrawal
    expect(html).toContain("No ban observed since");
    expect(html).toContain("<polyline"); // history sparkline from 2 samples
    expect(html).toContain(`https://t.me/genlayer_watchtower_bot?start=${ADDR}`);
  });
  it("lists observed ban windows", async () => {
    const v: Validator = { ...mine, status: "active", bans: [{ untilEpoch: "4", permanent: false, firstSeenAt: now - 7200, lastSeenAt: now - 3600 }], lastBannedAt: now - 3600 };
    mockApi({ [`/validators/${ADDR}`]: v, [`/validators/${ADDR}/history`]: [], [`/validators/${ADDR}/epochs`]: [] });
    const html = renderToStaticMarkup(await ValidatorPage({ params: Promise.resolve({ address: ADDR }) }));
    expect(html).toContain("Banned until epoch 4");
    expect(html).toContain(">Ended<");
    expect(html).not.toContain("No ban observed");
  });
  it("rejects malformed and unknown addresses", async () => {
    mockApi({});
    await expect(ValidatorPage({ params: Promise.resolve({ address: "nope" }) })).rejects.toThrow();
    await expect(ValidatorPage({ params: Promise.resolve({ address: ADDR }) })).rejects.toThrow();
  });
});
