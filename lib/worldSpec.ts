/**
 * Seed dials → WorldSpec.
 *
 * Digits encode world physics / social physics — never plot genre spoilers.
 * Layout: Option A (full 10-axis). Digit 1 is a hard ceiling on weirdness/abilities.
 */

export const SEED_DIGIT_COUNT = 10;
/** Random suffix after the 10 dial digits — unique instance ID, not a dial. */
export const SEED_INSTANCE_ID_LENGTH = 4;
export const SEED_CODE_MIN_LENGTH = SEED_DIGIT_COUNT;
export const SEED_CODE_MAX_LENGTH = SEED_DIGIT_COUNT + SEED_INSTANCE_ID_LENGTH;

export const DIAL_AXES = [
  { digit: 1, key: "world_type", name: "World type" },
  { digit: 2, key: "place_grain", name: "Place grain" },
  { digit: 3, key: "isolation", name: "Isolation" },
  { digit: 4, key: "law_pressure", name: "Law pressure" },
  { digit: 5, key: "information_opacity", name: "Information opacity" },
  { digit: 6, key: "npc_agency", name: "NPC agency" },
  { digit: 7, key: "scarcity", name: "Scarcity" },
  { digit: 8, key: "rule_density", name: "Rule density" },
  { digit: 9, key: "consequence_stickiness", name: "Consequence stickiness" },
  { digit: 10, key: "tone", name: "Tone / weirdness" },
] as const;

export type WorldType = "grounded" | "heightened" | "fantastical";

export type WorldSpec = {
  /** Full seed string (dial code + optional instance ID). */
  code: string;
  /** First 10 digits — WorldSpec dials only. */
  dial_code: string;
  /** Trailing digits after position 10 — instance ID, not a dial. */
  instance_id: string;
  /** Raw dial digits from dial_code (D10 may exceed effective tone). */
  raw_digits: number[];
  /** Effective dial values (D10 tone clamped by world_type). */
  digits: number[];
  world_type: WorldType;
  place_grain: number; // 0-9
  isolation: number;
  law_pressure: number;
  information_opacity: number;
  npc_agency: number;
  scarcity: number;
  rule_density: number;
  consequence_stickiness: number;
  tone: number; // clamped by world_type
  /** How many laws to seed at gen (derived from rule_density). */
  law_count: number;
  labels: {
    world_type: string;
    place_grain: string;
    isolation: string;
    law_pressure: string;
    information_opacity: string;
    npc_agency: string;
    scarcity: string;
    rule_density: string;
    consequence_stickiness: string;
    tone: string;
  };
  /** Human-readable constraints for the model. */
  constraints: string[];
  /** Crossed-pressure recipe hints. */
  crossed_pressures: string[];
};

function digit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(9, Math.floor(n)));
}

function bandWorldType(d: number): WorldType {
  if (d <= 3) return "grounded";
  if (d <= 6) return "heightened";
  return "fantastical";
}

function labelPlace(d: number): string {
  if (d <= 2) return "intimate room / vehicle";
  if (d <= 4) return "single building";
  if (d <= 6) return "block / small district";
  return "city-edge / wide map";
}

function labelIsolation(d: number): string {
  if (d <= 2) return "crowded / public";
  if (d <= 5) return "sparse";
  return "sealed / cut off";
}

function labelLaw(d: number): string {
  if (d <= 2) return "soft norms";
  if (d <= 5) return "formal law present";
  if (d <= 7) return "heavy enforcement";
  return "martial / cartel rule";
}

function labelOpacity(d: number): string {
  if (d <= 2) return "relatively readable";
  if (d <= 5) return "cryptic";
  return "actively lied about";
}

function labelAgency(d: number): string {
  if (d <= 2) return "passive NPCs";
  if (d <= 5) return "busy lives";
  return "hostile / driven agendas";
}

function labelScarcity(d: number): string {
  if (d <= 2) return "resources available";
  if (d <= 5) return "tight";
  return "desperate";
}

function labelRules(d: number): string {
  if (d <= 2) return "few soft customs";
  if (d <= 5) return "several brittle laws";
  return "taboo minefield";
}

function labelStick(d: number): string {
  if (d <= 2) return "forgiving";
  if (d <= 5) return "lasting scars";
  return "permanent consequences";
}

function labelTone(d: number, type: WorldType): string {
  if (type === "grounded") {
    if (d <= 4) return "dry realist";
    return "slightly uncanny (still grounded physics)";
  }
  if (type === "heightened") {
    if (d <= 3) return "heightened realist";
    if (d <= 6) return "uncanny";
    return "strange but rule-bound";
  }
  if (d <= 3) return "fantastical but coherent";
  if (d <= 6) return "surreal with declared powers";
  return "high weirdness (abilities must be declared)";
}

/** Clamp tone so grounded worlds never unlock magic via digit 10. */
export function clampTone(toneDigit: number, worldType: WorldType): number {
  const t = digit(toneDigit);
  if (worldType === "grounded") return Math.min(t, 4);
  if (worldType === "heightened") return Math.min(t, 7);
  return t;
}

function lawCountFromDensity(d: number): number {
  if (d <= 2) return 1 + (d === 2 ? 1 : 0); // 1–2
  if (d <= 5) return 3 + (d >= 4 ? 1 : 0); // 3–4
  return 5 + Math.min(2, d - 6); // 5–7
}

function crossedPressures(spec: Omit<WorldSpec, "crossed_pressures" | "constraints" | "labels">): string[] {
  const out: string[] = [];
  if (spec.law_pressure >= 6 && spec.scarcity >= 6) {
    out.push("High law + high scarcity → black markets, snitches, bribes, stolen goods with heat.");
  }
  if (spec.information_opacity >= 6 && spec.rule_density >= 6) {
    out.push("High opacity + high rule density → dangerous trial-and-error; laws bite before they are named.");
  }
  if (spec.isolation >= 6 && spec.npc_agency >= 6) {
    out.push("High isolation + high agency → few people, each with a strong agenda and off-screen timeline.");
  }
  if (spec.law_pressure <= 3 && spec.consequence_stickiness >= 6) {
    out.push("Low formal law + high stickiness → informal justice that scars permanently.");
  }
  if (spec.place_grain <= 2 && spec.isolation >= 6) {
    out.push("Intimate sealed place → pressure cooker; exits matter; chill is still allowed inside.");
  }
  if (spec.npc_agency >= 6 && spec.information_opacity >= 5) {
    out.push("Driven NPCs + opacity → conflicting stories; trust is earned, not given.");
  }
  if (out.length === 0) {
    out.push("No extreme crossed pair — keep pressures subtle and let player agency lead.");
  }
  return out;
}

function buildConstraints(spec: {
  world_type: WorldType;
  place_grain: number;
  isolation: number;
  law_pressure: number;
  information_opacity: number;
  npc_agency: number;
  scarcity: number;
  rule_density: number;
  consequence_stickiness: number;
  tone: number;
  law_count: number;
  labels: WorldSpec["labels"];
}): string[] {
  const c: string[] = [];
  c.push(`world_type=${spec.world_type} (${spec.labels.world_type}). Abilities[] empty unless heightened/fantastical and declared at gen.`);
  c.push(`Place grain: ${spec.labels.place_grain}. Build location graph to match; do not invent a continent if grain is intimate.`);
  c.push(`Isolation: ${spec.labels.isolation}. Ambient density and help availability follow this.`);
  c.push(`Law pressure: ${spec.labels.law_pressure}. Heat/response baseline should match.`);
  c.push(`Information opacity: ${spec.labels.information_opacity}. Do NOT dump true map/plot into SCENE; bury truths in STATE.`);
  c.push(`NPC agency: ${spec.labels.npc_agency}. Characters have wants/fears; high agency means off-screen motion.`);
  c.push(`Scarcity: ${spec.labels.scarcity}. Inventory and trade stakes follow this.`);
  c.push(`Seed exactly ${spec.law_count} entries in laws[] (rule density: ${spec.labels.rule_density}).`);
  c.push(`Consequence stickiness: ${spec.labels.consequence_stickiness}. Breaches leave lasting STATE changes.`);
  c.push(`Tone: ${spec.labels.tone}. Never break world_type ceiling.`);
  if (spec.world_type === "grounded") {
    c.push(
      "SETTING BIAS: contemporary normal life — street, forest, motel, apartment, parking lot, beach, highway shoulder, store, office, alley. No fairy tale, magic, dream logic, or cosmic weirdness."
    );
    c.push(
      "OPENING: plain place name only (e.g. YOU WAKE UP IN A FOREST / ON THE SIDE OF THE STREET). Mundane beats poetic."
    );
  }
  c.push("Digits are NOT a plot genre. starting_plot is a seed tension the player may ignore — not a railroad.");
  c.push("Chill exploration is first-class. Dials set baseline society/physics, not mandatory crisis every turn.");
  c.push("Character POV: opening and SCENE only what a disoriented person would notice.");
  return c;
}

/** Split a seed into dial code (10 digits) and instance ID suffix. */
export function parseSeedCode(code: string): {
  code: string;
  dial_code: string;
  instance_id: string;
} | null {
  const cleaned = String(code ?? "").trim();
  if (!/^\d{10,14}$/.test(cleaned)) return null;
  return {
    code: cleaned,
    dial_code: cleaned.slice(0, SEED_DIGIT_COUNT),
    instance_id: cleaned.slice(SEED_DIGIT_COUNT),
  };
}

/**
 * Decode a numeric seed code into a WorldSpec.
 * Layout: [10 dial digits][0–4 instance ID digits].
 * Only the first 10 digits affect WorldSpec; the suffix is a unique instance ID.
 */
export function decodeSeed(code: string): WorldSpec | null {
  const parts = parseSeedCode(code);
  if (!parts) return null;

  const raw_digits = parts.dial_code.split("").map((ch) => digit(Number(ch)));

  const world_type = bandWorldType(raw_digits[0]);
  const place_grain = raw_digits[1];
  const isolation = raw_digits[2];
  const law_pressure = raw_digits[3];
  const information_opacity = raw_digits[4];
  const npc_agency = raw_digits[5];
  const scarcity = raw_digits[6];
  const rule_density = raw_digits[7];
  const consequence_stickiness = raw_digits[8];
  const tone = clampTone(raw_digits[9], world_type);
  const digits = [...raw_digits.slice(0, 9), tone];
  const law_count = lawCountFromDensity(rule_density);

  const labels = {
    world_type:
      world_type === "grounded"
        ? "grounded everyday physics"
        : world_type === "heightened"
          ? "heightened (limited declared abilities)"
          : "fantastical (declared powers only)",
    place_grain: labelPlace(place_grain),
    isolation: labelIsolation(isolation),
    law_pressure: labelLaw(law_pressure),
    information_opacity: labelOpacity(information_opacity),
    npc_agency: labelAgency(npc_agency),
    scarcity: labelScarcity(scarcity),
    rule_density: labelRules(rule_density),
    consequence_stickiness: labelStick(consequence_stickiness),
    tone: labelTone(tone, world_type),
  };

  const base = {
    code: parts.code,
    dial_code: parts.dial_code,
    instance_id: parts.instance_id,
    raw_digits,
    digits,
    world_type,
    place_grain,
    isolation,
    law_pressure,
    information_opacity,
    npc_agency,
    scarcity,
    rule_density,
    consequence_stickiness,
    tone,
    law_count,
    labels,
  };

  return {
    ...base,
    constraints: buildConstraints({ ...base, labels }),
    crossed_pressures: crossedPressures(base),
  };
}

/** Prompt block injected into the opening instruction. */
export function formatWorldSpecForPrompt(spec: WorldSpec): string {
  const idLine = spec.instance_id
    ? `INSTANCE ID ${spec.instance_id} (not a dial — unique world instance)`
    : "INSTANCE ID (none — legacy 10-digit code)";
  const dialLines = [
    `DIAL CODE ${spec.dial_code} · ${idLine}`,
    `D1 world_type=${spec.world_type} (${spec.raw_digits[0]})`,
    `D2 place_grain=${spec.place_grain} (${spec.labels.place_grain})`,
    `D3 isolation=${spec.isolation} (${spec.labels.isolation})`,
    `D4 law_pressure=${spec.law_pressure} (${spec.labels.law_pressure})`,
    `D5 opacity=${spec.information_opacity} (${spec.labels.information_opacity})`,
    `D6 npc_agency=${spec.npc_agency} (${spec.labels.npc_agency})`,
    `D7 scarcity=${spec.scarcity} (${spec.labels.scarcity})`,
    `D8 rule_density=${spec.rule_density} → seed ${spec.law_count} laws[] (${spec.labels.rule_density})`,
    `D9 stickiness=${spec.consequence_stickiness} (${spec.labels.consequence_stickiness})`,
    `D10 tone=${spec.tone} (raw ${spec.raw_digits[9]}, clamped by D1) (${spec.labels.tone})`,
  ];

  return [
    `SEED ${spec.code} — WORLDSPEC (physics/social dials, NOT a plot spoiler sheet)`,
    ...dialLines,
    "CONSTRAINTS:",
    ...spec.constraints.map((c) => `- ${c}`),
    "CROSSED PRESSURES:",
    ...spec.crossed_pressures.map((c) => `- ${c}`),
    "Obey WORLDSPEC when building STATE. Put full geography and true_rule text only in STATE. SCENE stays character-POV.",
  ].join("\n");
}

export function buildOpeningInstruction(base: string, spec: WorldSpec | null): string {
  if (!spec) return base;
  return `${base}\n\n${formatWorldSpecForPrompt(spec)}`;
}

export type DialAxisRow = {
  digit: number;
  axis: string;
  key: string;
  raw_digit: number;
  effective_value: number;
  label: string;
  note?: string;
};

/** Per-axis summary for debug UI — all 10 dials with raw vs effective where they differ. */
export function dialBreakdown(spec: WorldSpec): DialAxisRow[] {
  const toneNote =
    spec.raw_digits[9] !== spec.tone
      ? `clamped from ${spec.raw_digits[9]} by world_type=${spec.world_type}`
      : undefined;
  return [
    { digit: 1, axis: "World type", key: "world_type", raw_digit: spec.raw_digits[0], effective_value: spec.digits[0], label: spec.labels.world_type },
    { digit: 2, axis: "Place grain", key: "place_grain", raw_digit: spec.place_grain, effective_value: spec.place_grain, label: spec.labels.place_grain },
    { digit: 3, axis: "Isolation", key: "isolation", raw_digit: spec.isolation, effective_value: spec.isolation, label: spec.labels.isolation },
    { digit: 4, axis: "Law pressure", key: "law_pressure", raw_digit: spec.law_pressure, effective_value: spec.law_pressure, label: spec.labels.law_pressure },
    { digit: 5, axis: "Information opacity", key: "information_opacity", raw_digit: spec.information_opacity, effective_value: spec.information_opacity, label: spec.labels.information_opacity },
    { digit: 6, axis: "NPC agency", key: "npc_agency", raw_digit: spec.npc_agency, effective_value: spec.npc_agency, label: spec.labels.npc_agency },
    { digit: 7, axis: "Scarcity", key: "scarcity", raw_digit: spec.scarcity, effective_value: spec.scarcity, label: spec.labels.scarcity },
    { digit: 8, axis: "Rule density", key: "rule_density", raw_digit: spec.rule_density, effective_value: spec.rule_density, label: `${spec.labels.rule_density} → ${spec.law_count} laws` },
    { digit: 9, axis: "Consequence stickiness", key: "consequence_stickiness", raw_digit: spec.consequence_stickiness, effective_value: spec.consequence_stickiness, label: spec.labels.consequence_stickiness },
    { digit: 10, axis: "Tone / weirdness", key: "tone", raw_digit: spec.raw_digits[9], effective_value: spec.tone, label: spec.labels.tone, note: toneNote },
  ];
}

/** Human-readable dial table for debug dumps. */
export function formatDialTableForDebug(spec: WorldSpec): string {
  const rows = dialBreakdown(spec);
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  const lines = [
    `FULL SEED:    ${spec.code}`,
    `DIAL CODE:    ${spec.dial_code}  (positions 1–10 — world physics / social dials)`,
    `INSTANCE ID:  ${spec.instance_id || "(none — legacy 10-digit code)"}`,
    "",
    `${pad("AXIS", 24)} ${pad("D#", 3)} ${pad("RAW", 4)} ${pad("EFF", 4)} LABEL`,
    `${"-".repeat(24)} ${"-".repeat(3)} ${"-".repeat(4)} ${"-".repeat(4)} ${"-".repeat(20)}`,
    ...rows.map((r) => {
      const eff =
        r.raw_digit === r.effective_value
          ? String(r.effective_value)
          : `${r.effective_value}*`;
      const note = r.note ? `  // ${r.note}` : "";
      return `${pad(r.axis, 24)} ${pad(String(r.digit), 3)} ${pad(String(r.raw_digit), 4)} ${pad(eff, 4)} ${r.label}${note}`;
    }),
    "",
    `world_type band: ${spec.world_type}`,
    `law_count (from D8): ${spec.law_count}`,
  ];
  return lines.join("\n");
}
