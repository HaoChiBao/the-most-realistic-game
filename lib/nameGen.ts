/**
 * Seeded NPC name generation — plausible, slightly uncommon contemporary names.
 * Avoids stock placeholders (Jane Doe, John Smith). Deterministic per seed+salt.
 */

import { seededRoll } from "@/lib/randomness";

export type GeneratedName = {
  full: string;
  first: string;
  last: string;
  /** Optional middle initial without period, e.g. "R". */
  middle?: string;
};

/** Contemporary first names — mixed, everyday, avoid ultra-generic defaults. */
const FIRST_NAMES = [
  "Aiden",
  "Amara",
  "Anika",
  "Ari",
  "Camila",
  "Carmen",
  "Cass",
  "Darius",
  "Elena",
  "Ellis",
  "Emre",
  "Esme",
  "Farah",
  "Felix",
  "Gia",
  "Hector",
  "Imani",
  "Ira",
  "Jamal",
  "Jasmin",
  "Jules",
  "Kai",
  "Keisha",
  "Lena",
  "Leon",
  "Lucia",
  "Malik",
  "Mara",
  "Mateo",
  "Mina",
  "Nadia",
  "Nico",
  "Noor",
  "Omar",
  "Pilar",
  "Priya",
  "Quinn",
  "Rafa",
  "Ren",
  "Rina",
  "Rosa",
  "Sami",
  "Sasha",
  "Selene",
  "Tariq",
  "Tess",
  "Theo",
  "Vera",
  "Vince",
  "Yara",
  "Zeke",
  "Zoe",
  "Andre",
  "Bea",
  "Cole",
  "Dina",
  "Evan",
  "Faye",
  "Gus",
  "Hana",
  "Ivy",
  "Jae",
  "Kira",
  "Lyle",
  "Moe",
  "Nell",
  "Otto",
  "Pax",
  "Remy",
  "Sid",
  "Tia",
  "Uma",
  "Wade",
  "Yael",
] as const;

/** Surnames with a bit of texture — no Doe / Smith / Johnson. */
const LAST_NAMES = [
  "Aldridge",
  "Barreto",
  "Beckett",
  "Brannigan",
  "Calloway",
  "Cho",
  "Cortez",
  "Davenport",
  "Delgado",
  "Ellison",
  "Farouk",
  "Fujita",
  "Gorski",
  "Hensley",
  "Ibarra",
  "Jabari",
  "Keating",
  "Kowalski",
  "Lagos",
  "Lindstrom",
  "Marquez",
  "Mercer",
  "Nguyen",
  "Okada",
  "Okonkwo",
  "Patel",
  "Quintero",
  "Reyes",
  "Rourke",
  "Salazar",
  "Santos",
  "Shaw",
  "Solano",
  "Tanaka",
  "Torres",
  "Vega",
  "Voss",
  "Whitaker",
  "Yates",
  "Zhou",
  "Ashford",
  "Boyle",
  "Crowe",
  "Dunne",
  "Everett",
  "Frost",
  "Glenn",
  "Haas",
  "Ingram",
  "Jin",
  "Kaur",
  "Lowe",
  "Morse",
  "Nash",
  "Ortega",
  "Pike",
  "Quinn",
  "Rowe",
  "Singh",
  "Trent",
  "Underwood",
  "Vale",
  "Wynn",
  "Xu",
  "York",
  "Zuniga",
] as const;

const MIDDLE_INITIALS = "ABCDEFGHJKLMNPRSTVWY";

const PLACEHOLDER_FULL = new Set(
  [
    "jane doe",
    "john doe",
    "jane smith",
    "john smith",
    "foo bar",
    "test user",
    "test npc",
    "npc",
    "character",
    "person",
    "stranger",
    "unknown",
    "n/a",
    "tbd",
  ].map((s) => s.toLowerCase())
);

const PLACEHOLDER_PARTS = new Set(
  ["doe", "smith", "jane", "john", "foo", "bar", "npc", "test"].map((s) =>
    s.toLowerCase()
  )
);

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function pick<T extends string>(
  list: readonly T[],
  seedCode: string | null | undefined,
  salt: string
): T {
  const roll = seededRoll(seedCode, 1, salt);
  return list[roll % list.length]!;
}

function formatName(first: string, last: string, middle?: string): string {
  if (middle) return `${first} ${middle}. ${last}`;
  return `${first} ${last}`;
}

/**
 * Generate one person name from seed + salt.
 * Texture roll (~12% middle initial, ~6% hyphenated compound surname).
 */
export function generatePersonName(
  seedCode: string | null | undefined,
  salt: string
): GeneratedName {
  let first: string = pick(FIRST_NAMES, seedCode, `${salt}|first`);
  let last: string = pick(LAST_NAMES, seedCode, `${salt}|last`);

  // Avoid accidental first===last oddities (e.g. Quinn Quinn).
  if (first.toLowerCase() === last.toLowerCase()) {
    last = pick(LAST_NAMES, seedCode, `${salt}|last|bump`);
  }

  const texture = seededRoll(seedCode, 1, `${salt}|texture`);

  // Compound surname: last-last2
  if (texture < 6) {
    let last2: string = pick(LAST_NAMES, seedCode, `${salt}|last2`);
    let guard = 0;
    while (
      (last2.toLowerCase() === last.toLowerCase() ||
        last2.toLowerCase() === first.toLowerCase()) &&
      guard < 5
    ) {
      last2 = pick(LAST_NAMES, seedCode, `${salt}|last2|${guard}`);
      guard++;
    }
    last = `${last}-${last2}`;
  }

  let middle: string | undefined;
  if (texture >= 6 && texture < 18) {
    const miRoll = seededRoll(seedCode, 1, `${salt}|mi`);
    middle = MIDDLE_INITIALS[miRoll % MIDDLE_INITIALS.length];
  }

  // Final placeholder guard (should be unreachable with these lists).
  let full = formatName(first, last, middle);
  if (isPlaceholderName(full)) {
    first = pick(FIRST_NAMES, seedCode, `${salt}|rescue|first`);
    last = pick(LAST_NAMES, seedCode, `${salt}|rescue|last`);
    middle = undefined;
    full = formatName(first, last);
  }

  return { full, first, last, middle };
}

/** Build a collision-resistant pool of names for a session. */
export function generateNamePool(
  seedCode: string | null | undefined,
  count: number
): GeneratedName[] {
  const n = Math.max(1, Math.min(24, Math.floor(count)));
  const out: GeneratedName[] = [];
  const seen = new Set<string>();
  let i = 0;
  let attempts = 0;
  while (out.length < n && attempts < n * 8) {
    const name = generatePersonName(seedCode, `pool|${i}`);
    i++;
    attempts++;
    const key = name.full.toLowerCase();
    if (seen.has(key)) continue;
    // Also avoid reusing same first+last stem without middle.
    const stem = `${name.first}|${name.last.split("-")[0]}`.toLowerCase();
    if (seen.has(stem)) continue;
    seen.add(key);
    seen.add(stem);
    out.push(name);
  }
  return out;
}

/** Stock / placeholder names the engine must never keep. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  if (name == null) return true;
  const trimmed = String(name).trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase().replace(/\./g, "");
  if (PLACEHOLDER_FULL.has(lower)) return true;
  if (/^(npc|char|character|person)[\s_-]?\d*$/i.test(trimmed)) return true;
  // "Jane Doe", "John Smith", etc.
  const parts = lower.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    if (PLACEHOLDER_PARTS.has(first) && PLACEHOLDER_PARTS.has(last)) return true;
    if (last === "doe" || (first === "jane" && last === "smith")) return true;
    if (first === "john" && last === "smith") return true;
  }
  // Role-as-name
  if (
    /^(officer|guard|cashier|bartender|stranger|civilian|passerby|superintendent)$/i.test(
      trimmed
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Compact prompt block assigning names the model must use for new cast.
 */
export function buildNamePoolPromptBlock(
  seedCode: string | null | undefined,
  count = 6
): string {
  const pool = generateNamePool(seedCode, count);
  const lines = [
    "[NAME POOL — server authoritative]",
    "Assign these as characters[].name for the cast (in order). Do NOT invent Jane Doe, John Smith, or other placeholder names.",
    "Names are STATE truth only until player_knowledge.name_known — still set the real name on the sheet.",
    ...pool.map((n, i) => `${i + 1}. ${n.full}`),
    "If you need more NPCs later, vary from this phonetic neighborhood — never reuse Doe/Smith placeholders.",
  ];
  return lines.join("\n");
}

/**
 * Spare names for mid-run introductions (skip names already on sheets).
 */
export function buildSpareNamesPromptBlock(
  seedCode: string | null | undefined,
  state: Record<string, unknown> | null | undefined,
  count = 3
): string {
  const used = new Set<string>();
  const chars = Array.isArray(state?.characters) ? state!.characters : [];
  for (const c of chars) {
    if (isRecord(c) && c.name != null) {
      used.add(String(c.name).toLowerCase());
    }
  }
  const pool = generateNamePool(seedCode, count + used.size + 4);
  const spare = pool
    .filter((n) => !used.has(n.full.toLowerCase()))
    .slice(0, count);
  if (spare.length === 0) return "";
  return [
    "[NAME POOL — spare names for NEW NPCs this turn if any]",
    ...spare.map((n) => `- ${n.full}`),
    "Use only when adding a new character sheet. Never Jane Doe / John Smith.",
  ].join("\n");
}

export type NameRepairResult = {
  state: Record<string, unknown>;
  replaced: { id: string; from: string; to: string }[];
};

/**
 * Replace placeholder / missing character names with seeded pool names.
 * Idempotent for already-good names.
 */
export function repairCharacterNames(
  state: Record<string, unknown> | null | undefined,
  seedCode: string | null | undefined
): NameRepairResult {
  const base: Record<string, unknown> =
    state && isRecord(state) ? { ...state } : {};
  const chars = Array.isArray(base.characters) ? [...base.characters] : [];
  if (chars.length === 0) {
    return { state: base, replaced: [] };
  }

  const used = new Set<string>();
  for (const c of chars) {
    if (!isRecord(c) || c.name == null) continue;
    const n = String(c.name).trim();
    if (n && !isPlaceholderName(n)) used.add(n.toLowerCase());
  }

  const pool = generateNamePool(seedCode, chars.length + 8);
  let poolIdx = 0;
  const replaced: { id: string; from: string; to: string }[] = [];

  const nextChars = chars.map((raw, i) => {
    if (!isRecord(raw) || raw.id == null) return raw;
    const from = raw.name != null ? String(raw.name) : "";
    if (from && !isPlaceholderName(from)) return raw;

    let pickName = pool[poolIdx++]?.full;
    while (pickName && used.has(pickName.toLowerCase())) {
      pickName = pool[poolIdx++]?.full;
    }
    if (!pickName) {
      pickName = generatePersonName(seedCode, `repair|${raw.id}|${i}`).full;
    }
    used.add(pickName.toLowerCase());
    replaced.push({
      id: String(raw.id),
      from: from || "(missing)",
      to: pickName,
    });
    return { ...raw, name: pickName };
  });

  return {
    state: { ...base, characters: nextChars },
    replaced,
  };
}
