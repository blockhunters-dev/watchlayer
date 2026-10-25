import type { Metadata } from "next";
import { BOT, botLink, PageHead, SectionHead } from "../components";

export const metadata: Metadata = { title: "Alerts" };

const ALERTS = [
  ["🚫", "Banned", "The protocol bans the validator, with the epoch the ban lasts until. Another message when the ban ends."],
  ["⛽", "Gas running out", "Operator gas runway drops under 3 days, and again under 1 day, at the current 24 h burn rate."],
  ["🔇", "Operator silent", "An active validator's operator sends no transaction for 6 hours, which usually means the node stopped."],
  ["🔧", "Needs priming", "The validator moves to the needs-priming state."],
  ["✅", "Stake activated", "A pending deposit becomes active stake."],
  ["⬆️", "Mandatory upgrade", "Changelog Guard reports a mandatory node release that your version does not meet (enabled once its contract is live)."],
] as const;

export default function Alerts() {
  return (
    <>
      <PageHead title="Alerts on Telegram" lead={`@${BOT} watches the validators you pick and messages you when something changes. Alerts fire once when a condition starts, not on every check.`}
        aside={<a className="btn primary" href={botLink()} target="_blank" rel="noopener noreferrer">Open @{BOT}</a>} />

      <SectionHead idx="01" title="Set up in a minute" />
      <div className="card">
        <ol className="steps">
          <li><div><strong>Open the bot</strong><div className="muted small">Tap the bell next to any validator on the Validators tab: Telegram opens the bot and subscribes you to that validator.</div></div></li>
          <li><div><strong>Or subscribe by address</strong><div className="muted small">Send <span className="cmd">/watch 0x…</span> with the validator wallet address. Repeat for as many validators as you like.</div></div></li>
          <li><div><strong>Manage</strong><div className="muted small"><span className="cmd">/list</span> shows your subscriptions, <span className="cmd">/status 0x…</span> gives a full report, <span className="cmd">/unwatch 0x…</span> stops alerts.</div></div></li>
        </ol>
      </div>

      <SectionHead idx="02" title="What you get alerted about" />
      <div className="alist">
        {ALERTS.map(([icon, title, text]) => (
          <div className="panel" key={title}><span className="ico" aria-hidden="true">{icon}</span><h3 style={{ marginTop: 8 }}>{title}</h3><p>{text}</p></div>
        ))}
      </div>
      <p className="small faint" style={{ marginTop: 16 }}>Checks run every 2 minutes against the latest WatchLayer snapshot. The bot stores only your chat id and the addresses you watch.</p>
    </>
  );
}
