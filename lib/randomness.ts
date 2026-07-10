/**
 * Hybrid randomness — server rolls table + tier; model narrates within tier.
 * Seeded from seedCode + turn for reproducible debug.
 */

import type { WorldSpec } from "@/lib/worldSpec";

export type RandomTable = "hazard" | "discovery" | "social" | "ambient";
export type RandomTier = "common" | "uncommon" | "rare" | "freak";

export type RandomRollResult = {
  fired: boolean;
  table: RandomTable | null;
  tier: RandomTier | null;
  roll: number;
  fire_threshold: number;
  chaos: number;
  trigger: string;
  action_tags: string[];
  modifiers: string[];
  fumble_eligible: boolean;
  prompt_block: string;
};

export type RandomnessState = {
  chaos?: number;
  cooldown_turns?: number;
  last_event_turn?: number | null;
};

const RUN_RE =
  /\b(run|sprint|flee|rush|dash|charge|hurry|bolts?|leg\s*it)\b/i;
const DISCOVERY_RE =
  /\b(walk|look|search|examine|inspect|cross|wade|scan|check|peer|study|explore|wait|listen|smell)\b/i;
const SOCIAL_RE =
  /\b(talk|ask|speak|shout|yell|hide|sneak|follow|approach|confront|negotiate|beg)\b/i;
const COMBAT_RE =
  /\b(shoot|fire|aim|draw|fight|punch|stab|kick|attack|gun|weapon|reload)\b/i;
const CHILL_RE =
  /\b(sit|rest|loiter|coffee|eat|drink|sleep|nap|browse|shop)\b/i;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Deterministic 0–99 roll from seed + turn + salt. */
export function seededRoll(
  seedCode: string | null | undefined,
  turn: number,
  salt: string
): number {
  const seed = seedCode ?? "0000000000";
  let h = 2166136261;
  const s = `${seed}|${turn}|${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100;
}

export function deriveChaos(
  spec: WorldSpec | null,
  stateRandomness?: RandomnessState | null
): number {
  if (
    stateRandomness?.chaos != null &&
    Number.isFinite(stateRandomness.chaos)
  ) {
    return clamp(Math.floor(stateRandomness.chaos), 0, 9);
  }
  if (!spec) return 4;
  return clamp(Math.round(spec.tone / 2 + spec.npc_agency / 3), 0, 9);
}

export function tagPlayerAction(text: string): string[] {
  const t = text.trim();
  if (!t) return ["idle"];
  const tags: string[] = [];
  if (RUN_RE.test(t)) tags.push("run");
  if (COMBAT_RE.test(t)) tags.push("combat");
  if (DISCOVERY_RE.test(t)) tags.push("discovery");
  if (SOCIAL_RE.test(t)) tags.push("social");
  if (CHILL_RE.test(t)) tags.push("chill");
  if (tags.length === 0) tags.push("other");
  return tags;
}

function pickTable(
  tags: string[],
  chaos: number,
  stallTurns: number
): RandomTable {
  if (tags.includes("combat") || (tags.includes("run") && tags.includes("combat"))) {
    return "hazard";
  }
  if (tags.includes("run")) return "hazard";
  if (tags.includes("social") && !tags.includes("discovery")) return "social";
  if (tags.includes("discovery") || tags.includes("chill")) return "discovery";
  if (stallTurns >= 2) return "ambient";
  if (chaos >= 6) return "ambient";
  return "discovery";
}

function hazardMultiplier(tags: string[]): number {
  let m = 1;
  if (tags.includes("run")) m *= 2;
  if (tags.includes("combat")) m *= 1.4;
  if (tags.includes("chill")) m *= 0.4;
  return m;
}

function discoveryMultiplier(tags: string[], revisit: boolean): number {
  let m = 1;
  if (tags.includes("discovery")) m *= 1.5;
  if (tags.includes("chill")) m *= 1.3;
  if (tags.includes("run")) m *= 0.3;
  if (revisit) m *= 1.8;
  return m;
}

function tierFromRoll(
  roll: number,
  table: RandomTable,
  opts: { fumbleEligible: boolean; chaos: number }
): RandomTier {
  // Weighted thresholds on 0–99 (lower roll = more severe for hazard; we invert for simplicity)
  const r = roll;
  let freakMax = opts.fumbleEligible && table === "hazard" ? 1 : 0;
  if (opts.chaos >= 8 && table === "discovery") freakMax = 2;
  if (freakMax && r < freakMax) return "freak";

  const rareMax = freakMax + (table === "hazard" ? 3 : 5) + (opts.chaos >= 6 ? 2 : 0);
  if (r < rareMax) return "rare";

  const uncommonMax = rareMax + (table === "hazard" ? 12 : 18);
  if (r < uncommonMax) return "uncommon";

  return "common";
}

const TIER_HINTS: Record<RandomTable, Record<RandomTier, string>> = {
  hazard: {
    common: "stumble, winded, drop item, mild trauma",
    uncommon: "hard fall, sprain, lose grip, moderate trauma",
    rare: "serious injury, weapon snag/discharge into ground",
    freak: "ND foot wound, head strike, catastrophic injury — only if context allows",
  },
  discovery: {
    common: "odd detail, smell, sound, footprint",
    uncommon: "useful item, partial clue, overheard name",
    rare: "strong clue tied to existing thread or law surface",
    freak: "eerie repeat symbol or recognition from noticed_before[]",
  },
  social: {
    common: "stranger glance, muffled argument",
    uncommon: "recognition, offer, minor conflict",
    rare: "witness, ally or enemy at wrong moment",
    freak: "named callback from a thread not yet met",
  },
  ambient: {
    common: "distant siren, flickering light, dog bark",
    uncommon: "rain, power dip, minor blockage",
    rare: "alarm, lockdown ripple, infrastructure shift",
    freak: "one-in-a-million environmental failure that matters",
  },
};

export function formatRollForPrompt(result: RandomRollResult): string {
  return result.prompt_block;
}

export function formatRandomnessGuide(): string {
  return [
    "HYBRID RANDOMNESS (server roll + model narration)",
    "",
    "Server picks table + tier before each player turn response.",
    "Model MUST honor tier severity and log in STATE.random_log[].",
    "",
    "TABLES: hazard | discovery | social | ambient",
    "TIERS: common (frequent) → uncommon → rare → freak (context-gated)",
    "",
    "chaos 0–9: derived from tone/agency dials or STATE.randomness.chaos",
    "fire chance ≈ 15% + chaos×3% (cooldown may skip)",
    "",
    "Action tags from player text toggle tables:",
    "  run/sprint → hazard ×2",
    "  look/walk/search → discovery",
    "  shoot/fight/draw → hazard + fumble freak if also running",
    "  chill/sit/loiter → discovery/social, low hazard",
    "",
    "noticed_before[] enables 'seen this before' on revisit discovery rolls.",
  ].join("\n");
}

export function extractRandomnessFromState(state: unknown): {
  randomness: RandomnessState | null;
  random_log: unknown[];
  noticed_before: string[];
} {
  if (!state || typeof state !== "object") {
    return { randomness: null, random_log: [], noticed_before: [] };
  }
  const s = state as Record<string, unknown>;
  return {
    randomness:
      s.randomness && typeof s.randomness === "object"
        ? (s.randomness as RandomnessState)
        : null,
    random_log: Array.isArray(s.random_log) ? s.random_log : [],
    noticed_before: Array.isArray(s.noticed_before)
      ? s.noticed_before.map(String)
      : [],
  };
}

export function computeHybridRoll(opts: {
  seedCode?: string | null;
  turn: number;
  playerAction: string;
  spec?: WorldSpec | null;
  state?: unknown;
  stallTurns?: number;
}): RandomRollResult {
  const {
    seedCode,
    turn,
    playerAction,
    spec = null,
    state,
    stallTurns = 0,
  } = opts;

  const { randomness, noticed_before } = extractRandomnessFromState(state);
  const chaos = deriveChaos(spec, randomness);
  const action_tags = tagPlayerAction(playerAction);
  const trigger = playerAction.trim().slice(0, 80) || "(empty action)";

  const player = (state as Record<string, unknown> | undefined)?.player as
    | Record<string, unknown>
    | undefined;
  const composure =
    player?.stats && typeof player.stats === "object"
      ? Number((player.stats as Record<string, unknown>).composure ?? 50)
      : 50;
  const hasFirearm =
    COMBAT_RE.test(playerAction) ||
    (Array.isArray(player?.inventory) &&
      JSON.stringify(player.inventory).toLowerCase().includes("gun"));

  const fumble_eligible =
    action_tags.includes("run") &&
    hasFirearm &&
    composure < 45;

  const revisit = noticed_before.length > 0;
  const modifiers: string[] = [];
  if (action_tags.includes("run")) modifiers.push("hazard×2");
  if (revisit && action_tags.includes("discovery"))
    modifiers.push("discovery×1.8 revisit");
  if (fumble_eligible) modifiers.push("fumble freak eligible");
  if (stallTurns >= 2) modifiers.push("stall ambient");

  const fire_threshold = clamp(15 + chaos * 3, 5, 45);
  const fire_roll = seededRoll(seedCode, turn, "fire");
  const cooldown = randomness?.cooldown_turns ?? 0;
  const highRisk =
    action_tags.includes("run") ||
    action_tags.includes("combat") ||
    fumble_eligible;

  let fired = fire_roll < fire_threshold;
  if (cooldown > 0 && chaos < 7 && !highRisk) fired = false;

  if (!fired) {
    return {
      fired: false,
      table: null,
      tier: null,
      roll: fire_roll,
      fire_threshold,
      chaos,
      trigger,
      action_tags,
      modifiers,
      fumble_eligible,
      prompt_block: [
        "[RANDOMNESS — server]",
        `no_roll turn=${turn} fire_roll=${fire_roll} threshold=${fire_threshold} chaos=${chaos}`,
        `action_tags=${action_tags.join(",")} cooldown=${cooldown}`,
        "Tick STATE.randomness.cooldown_turns down if >0. No forced random beat this turn unless action itself is risky.",
      ].join("\n"),
    };
  }

  const table = pickTable(action_tags, chaos, stallTurns);
  const tier_roll = seededRoll(seedCode, turn, `tier:${table}`);
  const tier = tierFromRoll(tier_roll, table, { fumbleEligible: fumble_eligible, chaos });
  const hint = TIER_HINTS[table][tier];

  const prompt_block = [
    "[RANDOMNESS ROLL — server authoritative]",
    `turn=${turn} table=${table} tier=${tier} tier_roll=${tier_roll} chaos=${chaos}`,
    `trigger="${trigger}"`,
    `action_tags=${action_tags.join(",")}`,
    modifiers.length ? `modifiers=${modifiers.join("; ")}` : null,
    `NARRATE: ${hint}`,
    "Log outcome in STATE.random_log[] with table/tier/outcome. Update randomness.cooldown_turns (set 1 after event, 0 on chill).",
    "Add to noticed_before[] on discovery. Apply conditions[] if injury. SCENE = POV only.",
    "Do NOT exceed tier severity. Freak ND only if fumble_eligible.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    fired: true,
    table,
    tier,
    roll: tier_roll,
    fire_threshold,
    chaos,
    trigger,
    action_tags,
    modifiers,
    fumble_eligible,
    prompt_block,
  };
}

export function formatRollOverview(result: RandomRollResult): string {
  if (!result.fired) {
    return [
      "RANDOM ROLL — no event this turn",
      "",
      `fire_roll ${result.roll} vs threshold ${result.fire_threshold} (chaos ${result.chaos})`,
      `tags: ${result.action_tags.join(", ")}`,
      `trigger: ${result.trigger}`,
      result.modifiers.length ? `modifiers: ${result.modifiers.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "RANDOM ROLL — fired",
    "",
    `table: ${result.table} · tier: ${result.tier} · tier_roll: ${result.roll}`,
    `chaos: ${result.chaos} · threshold: ${result.fire_threshold}`,
    `tags: ${result.action_tags.join(", ")}`,
    `fumble_eligible: ${result.fumble_eligible}`,
    `trigger: ${result.trigger}`,
    result.modifiers.length ? `modifiers: ${result.modifiers.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
