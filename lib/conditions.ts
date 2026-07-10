/**
 * Broad physical / environmental / cognitive conditions tracked in STATE.
 *
 * Specific flavors (hypothermia, bullet wound, poison) are `label` + `kind`.
 * The engine advances `severity` / `stage` every turn — not one-off narration.
 */

export const CONDITION_KINDS = [
  {
    kind: "trauma",
    name: "Physical trauma",
    covers:
      "Gunshot, stab, fracture, concussion, bruising, localized bleeding",
    story_effect:
      "Pain, mobility loss, combat penalty; can escalate to bleed-out death",
    death_path: "hp collapse, hemorrhage stage critical, trauma end_clause",
  },
  {
    kind: "exposure",
    name: "Environmental exposure",
    covers:
      "Hypothermia, heatstroke, frostbite, dehydration, heat exhaustion",
    story_effect:
      "Stamina drain, confused SCENE, movement limits; worsens in bad locations",
    death_path: "exposure stage terminal + no shelter/treatment",
  },
  {
    kind: "toxicity",
    name: "Toxicity / infection",
    covers:
      "Poison, venom, sepsis, infection, overdose, chemical burn, radiation",
    story_effect:
      "Delayed clock; symptoms vague at first; treatment or antidote threads",
    death_path: "toxicity terminal; organ failure end_clause",
  },
  {
    kind: "asphyxia",
    name: "Oxygen failure",
    covers: "Drowning, smoke inhalation, choking, gas, strangulation",
    story_effect: "Fast severity ramp; consciousness risk; urgent SCENE pressure",
    death_path: "asphyxia critical within few turns unless escaped",
  },
  {
    kind: "exhaustion",
    name: "System depletion",
    covers:
      "Starvation, sleep collapse, marathon exertion, untreated pain exhaustion",
    story_effect: "All stats degrade; composure crashes; forced rest or mistakes",
    death_path: "rare hard end; usually enables other kinds to finish you",
  },
  {
    kind: "distress",
    name: "Cognitive / nervous shock",
    covers: "Panic, shock, terror, dissociation, delirium (heightened worlds)",
    story_effect:
      "Awareness/composure gates; bad decisions; NPCs may exploit or help",
    death_path: "indirect — leads into traps, fights, exposure",
  },
  {
    kind: "restraint",
    name: "Restraint / entrapment",
    covers:
      "Handcuffed, pinned under debris, locked in, held hostage, buried",
    story_effect: "Blocks movement/combat/escape until resolved; heat may rise",
    death_path: "capture end_clause; paired trauma/asphyxia while trapped",
  },
] as const;

export type ConditionKind = (typeof CONDITION_KINDS)[number]["kind"];

export type ConditionStage =
  | "none"
  | "mild"
  | "moderate"
  | "severe"
  | "critical"
  | "terminal";

export type ConditionProgress =
  | "worsening"
  | "stable"
  | "improving"
  | "resolved";

export type ConditionRecord = {
  id: string;
  kind: ConditionKind;
  label: string;
  subject: string;
  severity: number;
  stage: ConditionStage;
  progress: ConditionProgress;
  turns_active: number;
  source?: string;
  gates?: string[];
  death_risk?: "none" | "low" | "medium" | "high" | "imminent";
  end_clause_link?: string | null;
  known_to_player?: boolean;
};

export function extractConditionsFromState(state: unknown): {
  player: ConditionRecord[];
  npc: ConditionRecord[];
  all: ConditionRecord[];
} {
  const all: ConditionRecord[] = [];
  if (!state || typeof state !== "object") {
    return { player: [], npc: [], all };
  }
  const s = state as Record<string, unknown>;

  const top = Array.isArray(s.conditions) ? s.conditions : [];
  for (const c of top) {
    if (c && typeof c === "object") all.push(c as ConditionRecord);
  }

  const player = s.player as Record<string, unknown> | undefined;
  if (player && Array.isArray(player.conditions)) {
    for (const c of player.conditions) {
      if (c && typeof c === "object") {
        const rec = c as ConditionRecord;
        if (!all.some((x) => x.id === rec.id)) all.push(rec);
      }
    }
  }

  const chars = Array.isArray(s.characters) ? s.characters : [];
  for (const ch of chars) {
    if (!ch || typeof ch !== "object") continue;
    const c = ch as Record<string, unknown>;
    const subj = String(c.id ?? "npc");
    if (!Array.isArray(c.conditions)) continue;
    for (const cond of c.conditions) {
      if (cond && typeof cond === "object") {
        const rec = { ...(cond as ConditionRecord), subject: subj };
        if (!all.some((x) => x.id === rec.id)) all.push(rec);
      }
    }
  }

  return {
    player: all.filter((c) => c.subject === "player"),
    npc: all.filter((c) => c.subject !== "player"),
    all,
  };
}

function pad(s: string, n: number): string {
  return s.padEnd(n).slice(0, n);
}

export function formatConditionsGuide(): string {
  const lines = [
    "CONDITION KINDS (broad families — use kind + specific label)",
    "",
    `${pad("KIND", 12)} ${pad("COVERS", 36)} DEATH / END PATH`,
    `${"-".repeat(12)} ${"-".repeat(36)} ${"-".repeat(24)}`,
    ...CONDITION_KINDS.map(
      (k) =>
        `${pad(k.kind, 12)} ${pad(k.covers.slice(0, 34), 36)} ${k.death_path}`
    ),
    "",
    "Every turn: advance severity/stage/progress for each active condition.",
    "end_clauses may reference kind + stage (e.g. exposure critical 2 turns).",
    "SCENE shows symptoms (character POV); full numbers stay in STATE.",
  ];
  return lines.join("\n");
}

export function formatConditionsOverview(
  bundle: ReturnType<typeof extractConditionsFromState>
): string {
  if (bundle.all.length === 0) {
    return [
      "CONDITIONS — none active",
      "",
      "Player and NPCs should carry conditions[] when injured, exposed, etc.",
      "See Conditions guide section for the 7 broad kinds.",
    ].join("\n");
  }

  const fmt = (c: ConditionRecord) => {
    const known = c.known_to_player ? "known" : "hidden";
    return [
      `  • ${c.id} [${c.kind}] ${c.label} — ${c.subject}`,
      `    stage ${c.stage} · severity ${c.severity} · ${c.progress} · ${c.turns_active} turns · risk ${c.death_risk ?? "?"}`,
      `    gates: ${(c.gates ?? []).join(", ") || "none"} · ${known}`,
      c.end_clause_link ? `    end_clause_link: ${c.end_clause_link}` : null,
      c.source ? `    source: ${c.source}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  };

  return [
    `CONDITIONS — ${bundle.all.length} active`,
    "",
    `Player (${bundle.player.length}):`,
    bundle.player.length ? bundle.player.map(fmt).join("\n") : "  (none)",
    "",
    `NPCs (${bundle.npc.length}):`,
    bundle.npc.length ? bundle.npc.map(fmt).join("\n") : "  (none)",
  ].join("\n");
}
