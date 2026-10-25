"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [["/", "Overview"], ["/validators", "Validators"], ["/bans", "Bans"], ["/epochs", "Epochs"], ["/alerts", "Alerts"]] as const;

export function Tabs() {
  const path = usePathname() ?? "/";
  const on = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <nav className="tabs" aria-label="Sections">
      {TABS.map(([href, label]) => <Link key={href} href={href} className={on(href) ? "tab on" : "tab"} aria-current={on(href) ? "page" : undefined}>{label}</Link>)}
    </nav>
  );
}
