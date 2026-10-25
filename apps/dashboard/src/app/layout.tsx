import type { Metadata } from "next";
import Link from "next/link";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { getNetwork } from "../lib/api";
import { relTime } from "../lib/format";
import { botLink, Mark } from "./components";
import { Tabs } from "./tabs";
import "./globals.css";

const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "WatchLayer — GenLayer validator monitor", template: "%s · WatchLayer" },
  description: "Live status, stake, bans and operator gas for every validator on GenLayer Testnet Bradbury, with Telegram alerts.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const net = await getNetwork();
  const now = Math.floor(Date.now() / 1000);
  const stale = !net || now - net.snapshotAt > 1200;
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} style={{ ["--font-display" as string]: "var(--font-sans)" }}>
      <body>
        <header className="top">
          <div className="wrap top-in">
            <Link href="/" className="brand"><Mark />WatchLayer</Link>
            <span className="net hide-m">Bradbury · chain 4221</span>
            <Tabs />
            <span className={stale ? "live stale" : "live"} title="Time since the last indexer snapshot">
              <i />{net ? `Live · ${relTime(net.snapshotAt, now)}` : "Offline"}
            </span>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="foot">
          <div className="wrap foot-in">
            <span>WatchLayer · read-only data from the public GenLayer RPC, refreshed every few minutes. Strikes are not exposed on-chain.</span>
            <span><a href={botLink()} target="_blank" rel="noopener noreferrer">Telegram alerts</a> · built by BlockHunters</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
