// Turns a verdict into a plain alert object for any sender (A's bot, email, log). It carries only
// fields the contract stores plus what decide() computed; it does not assume any Watchtower API field.
import { decide, compareVersions } from "./decide.mjs";

/**
 * @returns {null | {kind: "mandatory-upgrade", severity: "critical"|"warning", version: string, running: string,
 *   action: string, breaking: boolean, deadline: string|null, overdue: boolean, config_changes: string[],
 *   env_changes: string[], actions: string[], source_url: string|null, text: string}}
 * null when nothing needs attention: no verdict, not newer than `running`, or not mandatory.
 */
export function buildAlert(running, verdict, now = new Date()) {
  if (!verdict || !verdict.version || !verdict.mandatory) return null;
  if (compareVersions(verdict.version, running) <= 0) return null;
  const { action } = decide(running, verdict, now);
  const deadline = verdict.deadline ?? null;
  const overdue = deadline !== null && new Date(deadline) <= now;
  const breaking = verdict.breaking === true;
  const lists = {
    config_changes: verdict.config_changes ?? [],
    env_changes: verdict.env_changes ?? [],
    actions: verdict.actions ?? [],
  };
  const lines = [
    `Mandatory upgrade ${running} -> ${verdict.version}${deadline ? ` by ${deadline}${overdue ? " (OVERDUE)" : ""}` : ""}`,
    breaking ? "BREAKING: manual changes required, auto-upgrade is blocked." : "Not breaking: auto-upgrade is possible if enabled.",
    ...(lists.config_changes.length ? [`config: ${lists.config_changes.join(", ")}`] : []),
    ...(lists.env_changes.length ? [`env: ${lists.env_changes.join(", ")}`] : []),
    ...(lists.actions.length ? [`actions: ${lists.actions.join(", ")}`] : []),
    ...(verdict.source_url ? [`source: ${verdict.source_url}`] : []),
  ];
  return {
    kind: "mandatory-upgrade",
    severity: breaking || overdue ? "critical" : "warning",
    version: verdict.version,
    running,
    action,
    breaking,
    deadline,
    overdue,
    ...lists,
    source_url: verdict.source_url ?? null,
    text: lines.join("\n"),
  };
}
