const UNIT = 10n ** 18n;

/** Wei string -> "1,234.56 GEN" (2 decimals, truncated). */
export function gen(wei: string | null | undefined): string {
  if (wei == null) return "—";
  const w = BigInt(wei);
  const whole = (w / UNIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = ((w % UNIT) * 100n) / UNIT;
  return `${whole}.${frac.toString().padStart(2, "0")} GEN`;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function runway(days: number | null): string {
  if (days === null) return "unknown";
  if (days < 1) return `${Math.max(0, Math.round(days * 24))} h`;
  if (days >= 365) return `${(days / 365).toFixed(1)} y`;
  return `${days.toFixed(1)} d`;
}

/** "in 5h 12m" / "3m ago" relative to now (unix seconds). */
export function relTime(t: number | null, now: number): string {
  if (t === null) return "never";
  const d = t - now, a = Math.abs(d);
  const txt = a >= 86400 ? `${Math.floor(a / 86400)}d ${Math.floor((a % 86400) / 3600)}h`
    : a >= 3600 ? `${Math.floor(a / 3600)}h ${Math.floor((a % 3600) / 60)}m`
    : `${Math.max(0, Math.floor(a / 60))}m`;
  return d >= 0 ? `in ${txt}` : `${txt} ago`;
}

/** Runway severity used for colouring; mirrors the bot thresholds (3d / 1d). */
export function runwayLevel(days: number | null): "unknown" | "ok" | "warn" | "crit" {
  if (days === null) return "unknown";
  return days < 1 ? "crit" : days < 3 ? "warn" : "ok";
}

/** SVG polyline points for a series scaled into w×h (flat series draws mid-line). */
export function sparkPoints(values: number[], w: number, h: number, pad = 2): string {
  if (values.length === 0) return "";
  const min = Math.min(...values), max = Math.max(...values);
  const x = (i: number) => (values.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (values.length - 1));
  const y = (v: number) => (max === min ? h / 2 : h - pad - ((v - min) * (h - 2 * pad)) / (max - min));
  return values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
}
