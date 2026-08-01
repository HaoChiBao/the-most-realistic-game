/**
 * Readable WorldBible / validation / hydration audit dumps for debug + /commands.
 */

import type { ValidateIssue } from "@/lib/stateValidate";
import type { WorldBible } from "@/lib/worldBible";
import { worldBibleToRecord } from "@/lib/worldBible";

export type BibleCommitAudit = {
  at: string;
  source: "present" | "play" | "hydrate" | "seed" | "restore" | "rewind";
  rejected: boolean;
  issueCount: number;
  issues: ValidateIssue[];
};

export type HydrationAudit = {
  at: string;
  ok: boolean;
  failures: string[];
  retried: boolean;
  softPatched: boolean;
};

export function formatBibleOverview(bible: WorldBible | null | undefined): string {
  if (!bible) return "(no WorldBible — parse history or wait for opening)";

  const loc = bible.locations.find((l) => l.id === bible.player_location);
  const exits = loc?.exits?.length ? loc.exits.join(", ") : "(none)";
  const cast = bible.characters
    .slice(0, 8)
    .map((c) => {
      const where = c.location ? `@${c.location}` : "";
      const persona = [c.training, c.disposition, c.violence]
        .filter(Boolean)
        .join("/");
      return `  - ${c.id}${c.name ? ` (${c.name})` : ""} ${where} ${persona}`.trimEnd();
    })
    .join("\n");

  const lines = [
    `world_type: ${bible.world_type}`,
    `location: ${bible.player_location}  exits→ ${exits}`,
    `clock: turn ${bible.clock.turn}${
      bible.clock.time_of_day ? ` · ${bible.clock.time_of_day}` : ""
    }`,
    `heat: level ${bible.heat.level} · response ${bible.heat.response}`,
    `player: alive=${bible.player.alive} conscious=${bible.player.conscious} hp=${bible.player.stats.hp}`,
    `laws: ${bible.laws.length}  threads: ${bible.threads.length}  cast: ${bible.characters.length}`,
    `starting_plot: ${
      bible.starting_plot
        ? `${bible.starting_plot.id || "(no id)"} · ${bible.starting_plot.phase ?? "?"}`
        : "(none)"
    }`,
    `randomness: chaos ${bible.randomness.chaos} · cooldown ${bible.randomness.cooldown_turns}`,
    "",
    "— cast —",
    cast || "  (empty)",
  ];
  return lines.join("\n");
}

export function formatValidateIssues(issues: ValidateIssue[] | null | undefined): string {
  if (!issues || issues.length === 0) return "(no validation issues on last commit)";
  return issues
    .map((i) => `[${i.severity}] ${i.code}: ${i.message}`)
    .join("\n");
}

export function formatCommitAudit(
  audit: BibleCommitAudit | null | undefined
): string {
  if (!audit) return "(no commit audit yet — take a turn or hydrate)";
  const lines = [
    `at: ${audit.at}`,
    `source: ${audit.source}`,
    `rejected: ${audit.rejected}`,
    `issues: ${audit.issueCount}`,
    "",
    formatValidateIssues(audit.issues),
  ];
  return lines.join("\n");
}

export function formatHydrationAudit(
  audit: HydrationAudit | null | undefined
): string {
  if (!audit) return "(no hydration audit — shared seeds skip Phase B)";
  const lines = [
    `at: ${audit.at}`,
    `ok: ${audit.ok}`,
    `retried: ${audit.retried}`,
    `soft_patched: ${audit.softPatched}`,
    "",
    audit.failures.length
      ? audit.failures.map((f) => `✗ ${f}`).join("\n")
      : "(contract passed)",
  ];
  return lines.join("\n");
}

export function formatBibleGuide(): string {
  return [
    "WorldBible = runtime-owned canonical world state.",
    "Chat [WORLD] STATE is transport; commit path validates then writes the bible.",
    "",
    "Audit surfaces:",
    "  /bible          overview of live bible",
    "  /bible json     full bible JSON",
    "  /validate       last commit validation issues",
    "  /hydrate        hydration contract result",
    "  debug panel → WorldBible / Validate / Hydrate sections",
    "",
    "On hard reject the previous bible is kept (model SCENE may still show).",
    "Hydration contract fail → one retry → soft patch + playable defaults.",
  ].join("\n");
}

export function bibleJson(bible: WorldBible | null | undefined): unknown {
  if (!bible) return null;
  return worldBibleToRecord(bible);
}
