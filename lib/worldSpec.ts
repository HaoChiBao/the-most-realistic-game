/**
 * Seed dials → WorldSpec.
 *
 * Digits encode world physics / social physics — never plot genre spoilers.
 * Layout: Option A (full 10-axis). Digit 1 is a hard ceiling on weirdness/abilities.
 */

export const SEED_DIGIT_COUNT = 10;

export type WorldType = "grounded" | "heightened" | "fantastical";

export type WorldSpec = {
  code: string;
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
  c.push("Digits are NOT a plot genre. starting_plot is a seed tension the player may ignore — not a railroad.");
  c.push("Chill exploration is first-class. Dials set baseline society/physics, not mandatory crisis every turn.");
  c.push("Character POV: opening and SCENE only what a disoriented person would notice.");
  return c;
}

/**
 * Decode a numeric seed code into a WorldSpec.
 * Accepts 6–12 digits; uses first 10 (pads with 0 if shorter).
 */
export function decodeSeed(code: string): WorldSpec | null {
  const cleaned = String(code ?? "").trim();
  if (!/^\d{6,12}$/.test(cleaned)) return null;

  const raw = cleaned.padEnd(SEED_DIGIT_COUNT, "0").slice(0, SEED_DIGIT_COUNT);
  const digits = raw.split("").map((ch) => digit(Number(ch)));

  const world_type = bandWorldType(digits[0]);
  const place_grain = digits[1];
  const isolation = digits[2];
  const law_pressure = digits[3];
  const information_opacity = digits[4];
  const npc_agency = digits[5];
  const scarcity = digits[6];
  const rule_density = digits[7];
  const consequence_stickiness = digits[8];
  const tone = clampTone(digits[9], world_type);
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
    code: cleaned,
    digits: [...digits.slice(0, 9), tone],
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
  const dialLines = [
    `D1 world_type=${spec.world_type} (${spec.digits[0]})`,
    `D2 place_grain=${spec.place_grain} (${spec.labels.place_grain})`,
    `D3 isolation=${spec.isolation} (${spec.labels.isolation})`,
    `D4 law_pressure=${spec.law_pressure} (${spec.labels.law_pressure})`,
    `D5 opacity=${spec.information_opacity} (${spec.labels.information_opacity})`,
    `D6 npc_agency=${spec.npc_agency} (${spec.labels.npc_agency})`,
    `D7 scarcity=${spec.scarcity} (${spec.labels.scarcity})`,
    `D8 rule_density=${spec.rule_density} → seed ${spec.law_count} laws[] (${spec.labels.rule_density})`,
    `D9 stickiness=${spec.consequence_stickiness} (${spec.labels.consequence_stickiness})`,
    `D10 tone=${spec.tone} clamped (${spec.labels.tone})`,
  ];

  return [
    `SEED CODE ${spec.code} — WORLDSPEC (physics/social dials, NOT a plot spoiler sheet)`,
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

/** Per-digit summary for debug UI. */
export function dialBreakdown(spec: WorldSpec): { digit: number; name: string; value: number; label: string }[] {
  return [
    { digit: 1, name: "world_type", value: spec.digits[0], label: spec.labels.world_type },
    { digit: 2, name: "place_grain", value: spec.place_grain, label: spec.labels.place_grain },
    { digit: 3, name: "isolation", value: spec.isolation, label: spec.labels.isolation },
    { digit: 4, name: "law_pressure", value: spec.law_pressure, label: spec.labels.law_pressure },
    { digit: 5, name: "opacity", value: spec.information_opacity, label: spec.labels.information_opacity },
    { digit: 6, name: "npc_agency", value: spec.npc_agency, label: spec.labels.npc_agency },
    { digit: 7, name: "scarcity", value: spec.scarcity, label: spec.labels.scarcity },
    { digit: 8, name: "rule_density", value: spec.rule_density, label: `${spec.labels.rule_density} → ${spec.law_count} laws` },
    { digit: 9, name: "stickiness", value: spec.consequence_stickiness, label: spec.labels.consequence_stickiness },
    { digit: 10, name: "tone", value: spec.tone, label: spec.labels.tone },
  ];
}
