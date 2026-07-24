/**
 * NPC / character observability for the engine debug panel.
 *
 * Characters live in STATE.characters[] inside the latest assistant [WORLD] block.
 * The engine prompt requires a full sheet on first mention and updates every turn.
 */

export type CharacterMemory = {
  turn: number;
  event: string;
  emotional_weight?: string;
};

export type CharacterSheet = {
  id: string;
  name?: string;
  aliases?: string[];
  role?: string;
  archetype?: string;
  location?: string;
  appearance?: string;
  personality?: string[];
  speech_style?: string;
  backstory_hints?: string[];
  inventory?: unknown[];
  body?: Record<string, string>;
  stats?: Record<string, number>;
  trust_to_player?: number;
  disposition?: string;
  relationship_to_player?: string;
  memory?: CharacterMemory[];
  introduced_turn?: number;
  last_seen_turn?: number;
  last_interaction_turn?: number;
  wants?: string;
  fears?: string;
  violence?: string;
  combat_posture?: string;
  will_fight_back?: boolean;
  authority_level?: string;
  training?: string;
  laws_care?: string[];
  laws_enforce?: string[];
  laws_break?: string[];
  known_to_player?: boolean;
  conscious?: boolean;
  alive?: boolean;
  status?: string;
  conditions?: unknown[];
  abilities?: string[];
  traits?: string[];
};

export type CharacterBundle = {
  characters: CharacterSheet[];
  count: number;
  introduced_this_session: number;
  hostile_count: number;
  combat_ready: number;
};

export const CHARACTER_STATE_KEYS = [
  {
    key: "characters[]",
    role: "Authoritative NPC registry — every person the world knows about",
    prompt: "NPC REGISTRY + STATE schema characters[]",
  },
  {
    key: "memory[]",
    role: "Per-NPC interaction log — append each significant beat",
    prompt: "NPC REGISTRY — memory[] on each character",
  },
  {
    key: "disposition",
    role: "Current stance toward player (hostile → allied)",
    prompt: "NPC COMBAT & SELF-DEFENSE + disposition updates",
  },
  {
    key: "combat_posture",
    role: "Live combat stance — must change when attacked",
    prompt: "NPC COMBAT & SELF-DEFENSE",
  },
  {
    key: "training / authority_level",
    role: "Who wins fights — trained guard vs untrained player",
    prompt: "NPC COMBAT & SELF-DEFENSE + MULTI-OPPONENT COMBAT",
  },
] as const;

function asSheet(raw: unknown): CharacterSheet | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.id == null) return null;
  return {
    id: String(o.id),
    name: o.name != null ? String(o.name) : undefined,
    aliases: Array.isArray(o.aliases) ? o.aliases.map(String) : undefined,
    role: o.role != null ? String(o.role) : undefined,
    archetype: o.archetype != null ? String(o.archetype) : undefined,
    location: o.location != null ? String(o.location) : undefined,
    appearance: o.appearance != null ? String(o.appearance) : undefined,
    personality: Array.isArray(o.personality)
      ? o.personality.map(String)
      : undefined,
    speech_style:
      o.speech_style != null ? String(o.speech_style) : undefined,
    backstory_hints: Array.isArray(o.backstory_hints)
      ? o.backstory_hints.map(String)
      : undefined,
    inventory: Array.isArray(o.inventory) ? o.inventory : undefined,
    body:
      o.body && typeof o.body === "object"
        ? (o.body as Record<string, string>)
        : undefined,
    stats:
      o.stats && typeof o.stats === "object"
        ? (o.stats as Record<string, number>)
        : undefined,
    trust_to_player:
      typeof o.trust_to_player === "number" ? o.trust_to_player : undefined,
    disposition:
      o.disposition != null ? String(o.disposition) : undefined,
    relationship_to_player:
      o.relationship_to_player != null
        ? String(o.relationship_to_player)
        : undefined,
    memory: Array.isArray(o.memory)
      ? o.memory
          .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
          .map((m) => ({
            turn: typeof m.turn === "number" ? m.turn : 0,
            event: String(m.event ?? ""),
            emotional_weight:
              m.emotional_weight != null
                ? String(m.emotional_weight)
                : undefined,
          }))
      : undefined,
    introduced_turn:
      typeof o.introduced_turn === "number" ? o.introduced_turn : undefined,
    last_seen_turn:
      typeof o.last_seen_turn === "number" ? o.last_seen_turn : undefined,
    last_interaction_turn:
      typeof o.last_interaction_turn === "number"
        ? o.last_interaction_turn
        : undefined,
    wants: o.wants != null ? String(o.wants) : undefined,
    fears: o.fears != null ? String(o.fears) : undefined,
    violence: o.violence != null ? String(o.violence) : undefined,
    combat_posture:
      o.combat_posture != null ? String(o.combat_posture) : undefined,
    will_fight_back:
      typeof o.will_fight_back === "boolean" ? o.will_fight_back : undefined,
    authority_level:
      o.authority_level != null ? String(o.authority_level) : undefined,
    training: o.training != null ? String(o.training) : undefined,
    laws_care: Array.isArray(o.laws_care) ? o.laws_care.map(String) : undefined,
    laws_enforce: Array.isArray(o.laws_enforce)
      ? o.laws_enforce.map(String)
      : undefined,
    laws_break: Array.isArray(o.laws_break)
      ? o.laws_break.map(String)
      : undefined,
    known_to_player:
      typeof o.known_to_player === "boolean" ? o.known_to_player : undefined,
    conscious: typeof o.conscious === "boolean" ? o.conscious : undefined,
    alive: typeof o.alive === "boolean" ? o.alive : undefined,
    status: o.status != null ? String(o.status) : undefined,
    conditions: Array.isArray(o.conditions) ? o.conditions : undefined,
    abilities: Array.isArray(o.abilities) ? o.abilities.map(String) : undefined,
    traits: Array.isArray(o.traits) ? o.traits.map(String) : undefined,
  };
}

export function extractCharactersFromState(state: unknown): CharacterBundle | null {
  if (!state || typeof state !== "object") return null;
  const s = state as Record<string, unknown>;
  const raw = Array.isArray(s.characters) ? s.characters : [];
  const characters = raw
    .map(asSheet)
    .filter((c): c is CharacterSheet => c !== null);

  const hostile = characters.filter(
    (c) =>
      c.disposition === "hostile" ||
      (c.trust_to_player != null && c.trust_to_player < -30)
  );
  const combatReady = characters.filter(
    (c) =>
      c.alive !== false &&
      c.conscious !== false &&
      (c.will_fight_back === true ||
        c.violence === "fight" ||
        c.violence === "call_help")
  );

  return {
    characters,
    count: characters.length,
    introduced_this_session: characters.filter(
      (c) => c.introduced_turn != null
    ).length,
    hostile_count: hostile.length,
    combat_ready: combatReady.length,
  };
}

const CORE_STAT_KEYS = ["hp", "stamina", "pain"] as const;
const SKILL_STAT_KEYS = [
  "combat",
  "firearms",
  "awareness",
  "composure",
  "mobility",
] as const;
const BODY_PART_ORDER = [
  "head",
  "torso",
  "left_arm",
  "right_arm",
  "left_leg",
  "right_leg",
] as const;

export type VitalsSource = {
  label: string;
  body?: Record<string, string>;
  stats?: Record<string, number>;
  conscious?: boolean;
  alive?: boolean;
  status?: string;
  conditions?: unknown[];
  traits?: string[];
  abilities?: string[];
};

function numStats(stats?: Record<string, number>): Record<string, number> {
  if (!stats) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Readable hp / body / skills dump for /health and /traits. */
export function formatVitalsOverview(source: VitalsSource): string {
  const stats = numStats(source.stats);
  const body = source.body ?? {};
  const lines: string[] = [`VITALS — ${source.label}`, ""];

  const flags: string[] = [];
  if (source.alive === false) flags.push("DEAD");
  else if (source.alive === true) flags.push("alive");
  if (source.conscious === false) flags.push("UNCONSCIOUS");
  else if (source.conscious === true) flags.push("conscious");
  if (source.status && source.status !== "ok") {
    flags.push(`status: ${source.status}`);
  }
  if (flags.length) {
    lines.push(flags.join("  |  "), "");
  }

  lines.push("— vitals —");
  let hasCore = false;
  for (const key of CORE_STAT_KEYS) {
    if (stats[key] != null) {
      lines.push(`  ${key.padEnd(10)} ${stats[key]}`);
      hasCore = true;
    }
  }
  if (!hasCore) lines.push("  (no hp/stamina/pain in STATE)");

  lines.push("", "— skills —");
  let hasSkills = false;
  for (const key of SKILL_STAT_KEYS) {
    if (stats[key] != null) {
      lines.push(`  ${key.padEnd(10)} ${stats[key]}`);
      hasSkills = true;
    }
  }
  const known = new Set<string>([...CORE_STAT_KEYS, ...SKILL_STAT_KEYS]);
  const extras = Object.entries(stats).filter(([k]) => !known.has(k));
  for (const [k, v] of extras) {
    lines.push(`  ${k.padEnd(10)} ${v}`);
    hasSkills = true;
  }
  if (!hasSkills) lines.push("  (no skill stats in STATE)");

  lines.push("", "— body —");
  const seen = new Set<string>();
  for (const part of BODY_PART_ORDER) {
    if (body[part] != null) {
      lines.push(`  ${part.padEnd(12)} ${body[part]}`);
      seen.add(part);
    }
  }
  for (const [part, status] of Object.entries(body)) {
    if (seen.has(part)) continue;
    lines.push(`  ${part.padEnd(12)} ${status}`);
    seen.add(part);
  }
  if (seen.size === 0) lines.push("  (no body map in STATE)");

  if (source.conditions && source.conditions.length > 0) {
    lines.push("", "— conditions —", fmt(source.conditions));
  } else {
    lines.push("", "— conditions —", "  (none)");
  }

  if (source.traits && source.traits.length > 0) {
    lines.push("", "— traits —", `  ${source.traits.join(", ")}`);
  }
  if (source.abilities && source.abilities.length > 0) {
    lines.push("", "— abilities —", `  ${source.abilities.join(", ")}`);
  }

  return lines.join("\n");
}

export function vitalsFromPlayer(
  player: Record<string, unknown> | null | undefined
): VitalsSource | null {
  if (!player || typeof player !== "object") return null;
  return {
    label: "PLAYER",
    body:
      player.body && typeof player.body === "object"
        ? (player.body as Record<string, string>)
        : undefined,
    stats:
      player.stats && typeof player.stats === "object"
        ? (player.stats as Record<string, number>)
        : undefined,
    conscious:
      typeof player.conscious === "boolean" ? player.conscious : undefined,
    alive: typeof player.alive === "boolean" ? player.alive : undefined,
    status: player.status != null ? String(player.status) : undefined,
    conditions: Array.isArray(player.conditions) ? player.conditions : undefined,
    traits: Array.isArray(player.traits) ? player.traits.map(String) : undefined,
    abilities: Array.isArray(player.abilities)
      ? player.abilities.map(String)
      : undefined,
  };
}

export function vitalsFromCharacter(c: CharacterSheet): VitalsSource {
  return {
    label: c.name ? `${c.name} (${c.id})` : c.id,
    body: c.body,
    stats: c.stats,
    conscious: c.conscious,
    alive: c.alive,
    status: c.status,
    conditions: c.conditions,
    traits: c.traits,
    abilities: c.abilities,
  };
}

function summarizeCharacter(c: CharacterSheet, i: number): string {
  const label = c.name ? `${c.name} (${c.id})` : c.id;
  const stats = numStats(c.stats);
  const vitalsBits = [
    stats.hp != null ? `hp ${stats.hp}` : null,
    stats.stamina != null ? `stam ${stats.stamina}` : null,
    stats.pain != null && stats.pain > 0 ? `pain ${stats.pain}` : null,
    stats.combat != null ? `combat ${stats.combat}` : null,
  ].filter(Boolean);
  const injured = c.body
    ? Object.entries(c.body).filter(([, v]) => v && v !== "ok")
    : [];
  const parts = [
    `  • ${label}`,
    c.role ? `role: ${c.role}` : null,
    c.archetype ? `archetype: ${c.archetype}` : null,
    c.location ? `loc: ${c.location}` : null,
    c.disposition ? `disposition: ${c.disposition}` : null,
    c.trust_to_player != null ? `trust: ${c.trust_to_player}` : null,
    vitalsBits.length ? vitalsBits.join(" · ") : null,
    injured.length
      ? `injuries: ${injured.map(([k, v]) => `${k}=${v}`).join(", ")}`
      : null,
    c.violence ? `violence: ${c.violence}` : null,
    c.combat_posture ? `posture: ${c.combat_posture}` : null,
    c.training ? `training: ${c.training}` : null,
    c.authority_level ? `authority: ${c.authority_level}` : null,
    c.status && c.status !== "ok" ? `status: ${c.status}` : null,
    c.alive === false ? "DEAD" : null,
    c.conscious === false ? "UNCONSCIOUS" : null,
    c.introduced_turn != null ? `introduced turn ${c.introduced_turn}` : null,
    c.memory?.length ? `memory: ${c.memory.length} entries` : null,
  ].filter(Boolean);
  if (parts.length === 1) return `  [${i}] ${c.id}`;
  return parts.join("\n    ");
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatCharactersOverview(
  bundle: CharacterBundle | null,
  opts?: { label?: string; turnHint?: string }
): string {
  const label = opts?.label ?? "CURRENT TURN";
  const turnHint = opts?.turnHint ?? "";

  if (!bundle) {
    return [
      `CHARACTERS — ${label}${turnHint}`,
      "",
      "(no STATE JSON parsed — characters live inside [WORLD] → STATE.characters[])",
      "",
      "Expected: full sheet on first mention; update every turn; memory[] for interactions.",
    ].join("\n");
  }

  const lines = [
    `CHARACTERS — ${label}${turnHint}`,
    "",
    "WHERE STORED: STATE.characters[] inside latest assistant [WORLD] block.",
    "RULE: every person named or described in [SCENE] must have a sheet same turn.",
    "RULE: NPCs fight back when attacked — trained authority wins vs untrained player.",
    "",
    `count: ${bundle.count}  |  hostile-ish: ${bundle.hostile_count}  |  combat-capable: ${bundle.combat_ready}`,
    "",
    `— roster (${bundle.count}) —`,
    bundle.characters.length
      ? bundle.characters.map(summarizeCharacter).join("\n")
      : "  (empty — engine should seed 1–3+ at gen; add every new person encountered)",
  ];

  const withMemory = bundle.characters.filter((c) => (c.memory?.length ?? 0) > 0);
  if (withMemory.length > 0) {
    lines.push("", "— recent memory (per NPC) —");
    for (const c of withMemory) {
      const last = c.memory!.slice(-3);
      lines.push(`  ${c.name ?? c.id}:`);
      for (const m of last) {
        lines.push(`    turn ${m.turn}: ${m.event}`);
      }
    }
  }

  return lines.join("\n");
}

export function formatCharacterStorageGuide(): string {
  const keyLines = CHARACTER_STATE_KEYS.map(
    (k) => `  ${k.key.padEnd(22)} ${k.role}`
  );
  return [
    "HOW CHARACTERS ARE STORED & USED",
    "",
    "REGISTRY",
    "  • characters[] is the authoritative NPC list for the whole session",
    "  • First mention in [SCENE] → add full sheet that same turn (plot or passerby)",
    "  • Player asks about someone → expand appearance/personality/memory; never contradict",
    "  • Off-screen NPCs still update location/status when npc_agency dial is high",
    "",
    "COMBAT REALISM",
    "  • will_fight_back + training + combat stats decide who wins",
    "  • Security guard / cop vs untrained player: NPC should win, restrain, or kill",
    "  • combat_posture must escalate when attacked — no passive punching bags",
    "  • Sustained assault → knockout, relocation, hard <END>, or lethal force",
    "",
    "STATE KEYS",
    ...keyLines,
    "",
    "PLAYER VISIBILITY",
    "  • [SCENE] shows only what the character perceives — not full sheets",
    "  • Stats and hidden motives stay in STATE until earned by action",
  ].join("\n");
}

/** Pull character-related sections from the system prompt for debug. */
export function extractCharacterPromptExcerpts(systemPrompt: string): string {
  const markers: [string, RegExp][] = [
    [
      "NPC REGISTRY & PERSONAS",
      /NPC REGISTRY & PERSONAS[\s\S]*?CHARACTER CONSISTENCY[\s\S]*?Contradiction → fix STATE first, then write \[SCENE\]\. Append memory on conflicts\./,
    ],
    [
      "NPC COMBAT & SELF-DEFENSE",
      /NPC COMBAT & SELF-DEFENSE[\s\S]*?When player asks about an NPC later, facts MUST match memory\[\] and sheet fields\./,
    ],
    [
      "MULTI-OPPONENT COMBAT",
      /MULTI-OPPONENT COMBAT[\s\S]*?HEAT \/ WANTED/,
    ],
    [
      "STATS POLICY (characters)",
      /When a character is FIRST named in \[SCENE\][\s\S]*?pain and low stamina degrade all actions\./,
    ],
  ];

  const chunks: string[] = ["CHARACTER RULES IN SYSTEM PROMPT (excerpts)", ""];
  for (const [title, re] of markers) {
    const m = systemPrompt.match(re);
    chunks.push(`--- ${title} ---`);
    chunks.push(m ? m[0].trim() : "(section not found)");
    chunks.push("");
  }
  return chunks.join("\n").trimEnd();
}
