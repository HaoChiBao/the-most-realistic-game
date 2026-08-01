/**
 * Typed WorldBible — runtime-owned canonical world state (Phase 1.1).
 * Chat [WORLD] STATE remains transport; normalize + commit write the bible.
 */

import type { ClientTurn } from "@/lib/gameMessages";
import { extractStateJson } from "@/lib/stateParse";
import type { WorldType } from "@/lib/worldSpec";

const WORLD_TYPES = new Set<WorldType>([
  "grounded",
  "heightened",
  "fantastical",
]);

const BODY_PARTS = [
  "head",
  "torso",
  "left_arm",
  "right_arm",
  "left_leg",
  "right_leg",
] as const;

const DEFAULT_BODY: Record<string, string> = {
  head: "ok",
  torso: "ok",
  left_arm: "ok",
  right_arm: "ok",
  left_leg: "ok",
  right_leg: "ok",
};

const DEFAULT_STATS: Record<string, number> = {
  hp: 100,
  stamina: 80,
  pain: 0,
  combat: 20,
  firearms: 15,
  awareness: 40,
  composure: 50,
  mobility: 100,
};

const CORE_STATS = Object.keys(DEFAULT_STATS);

export type WorldLocation = {
  id: string;
  exits: string[];
  tags?: string[];
  known_to_player?: boolean;
  [key: string]: unknown;
};

export type PlayerSheet = {
  id: string;
  inventory: unknown[];
  body: Record<string, string>;
  stats: Record<string, number>;
  abilities: unknown[];
  traits: unknown[];
  flags: unknown[];
  conditions: unknown[];
  conscious: boolean;
  alive: boolean;
  [key: string]: unknown;
};

export type BibleCharacter = {
  id: string;
  name?: string;
  role?: string;
  location?: string;
  archetype?: string;
  disposition?: string;
  training?: string;
  violence?: string;
  authority_level?: string;
  [key: string]: unknown;
};

export type WorldLaw = {
  id: string;
  surface?: string;
  true_rule?: string;
  known_to_player?: boolean;
  [key: string]: unknown;
};

export type HeatState = {
  level: number;
  response: string;
  wanted_by?: unknown[];
  witnesses?: boolean;
  last_crime?: string | null;
  backup_eta_turn?: number | null;
  [key: string]: unknown;
};

export type ClockState = {
  turn: number;
  time_of_day?: string;
  [key: string]: unknown;
};

export type StartingPlot = {
  id: string;
  hook?: string;
  phase?: string;
  countdown_sec?: number | null;
  [key: string]: unknown;
};

export type RandomnessBible = {
  chaos: number;
  cooldown_turns: number;
  last_event_turn: number | null;
  [key: string]: unknown;
};

export type ThreadRef = {
  id: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
};

/** Canonical subset of STATE the runtime owns. */
export type WorldBible = {
  world_type: WorldType;
  player_location: string;
  locations: WorldLocation[];
  player: PlayerSheet;
  characters: BibleCharacter[];
  laws: WorldLaw[];
  heat: HeatState;
  clock: ClockState;
  conditions: unknown[];
  threads: ThreadRef[];
  starting_plot: StartingPlot | null;
  randomness: RandomnessBible;
  random_log: unknown[];
  /** Passthrough keys preserved for merge/debug compat. */
  extras: Record<string, unknown>;
};

const KNOWN_KEYS = new Set([
  "world_type",
  "player_location",
  "locations",
  "player",
  "characters",
  "laws",
  "heat",
  "clock",
  "conditions",
  "threads",
  "starting_plot",
  "randomness",
  "random_log",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asString(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v);
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function normalizeWorldType(v: unknown): WorldType {
  const s = asString(v, "grounded") as WorldType;
  return WORLD_TYPES.has(s) ? s : "grounded";
}

function scaffoldPlayer(): PlayerSheet {
  return {
    id: "player",
    inventory: [],
    body: { ...DEFAULT_BODY },
    stats: { ...DEFAULT_STATS },
    abilities: [],
    traits: [],
    flags: [],
    conditions: [],
    conscious: true,
    alive: true,
  };
}

function normalizePlayer(raw: unknown): PlayerSheet {
  const p = isRecord(raw) ? raw : {};
  const bodyIn = isRecord(p.body) ? p.body : {};
  const statsIn = isRecord(p.stats) ? p.stats : {};
  const body: Record<string, string> = { ...DEFAULT_BODY };
  for (const part of BODY_PARTS) {
    if (bodyIn[part] != null) body[part] = asString(bodyIn[part], "ok");
  }
  const stats: Record<string, number> = { ...DEFAULT_STATS };
  for (const key of CORE_STATS) {
    if (statsIn[key] != null) stats[key] = asNumber(statsIn[key], stats[key]!);
  }
  return {
    ...p,
    id: asString(p.id, "player") || "player",
    inventory: Array.isArray(p.inventory) ? p.inventory : [],
    body,
    stats,
    abilities: Array.isArray(p.abilities) ? p.abilities : [],
    traits: Array.isArray(p.traits) ? p.traits : [],
    flags: Array.isArray(p.flags) ? p.flags : [],
    conditions: Array.isArray(p.conditions) ? p.conditions : [],
    conscious: asBool(p.conscious, true),
    alive: asBool(p.alive, true),
  };
}

function normalizeLocations(raw: unknown): WorldLocation[] {
  if (!Array.isArray(raw)) return [];
  const out: WorldLocation[] = [];
  for (const item of raw) {
    if (!isRecord(item) || item.id == null) continue;
    out.push({
      ...item,
      id: asString(item.id),
      exits: Array.isArray(item.exits) ? item.exits.map(String) : [],
    });
  }
  return out;
}

function normalizeCharacters(raw: unknown): BibleCharacter[] {
  if (!Array.isArray(raw)) return [];
  const out: BibleCharacter[] = [];
  for (const item of raw) {
    if (!isRecord(item) || item.id == null) continue;
    out.push({
      ...item,
      id: asString(item.id),
      name: item.name != null ? asString(item.name) : undefined,
      role: item.role != null ? asString(item.role) : undefined,
      location: item.location != null ? asString(item.location) : undefined,
      archetype: item.archetype != null ? asString(item.archetype) : undefined,
      disposition:
        item.disposition != null ? asString(item.disposition) : undefined,
      training: item.training != null ? asString(item.training) : undefined,
      violence: item.violence != null ? asString(item.violence) : undefined,
      authority_level:
        item.authority_level != null
          ? asString(item.authority_level)
          : undefined,
    });
  }
  return out;
}

function normalizeLaws(raw: unknown): WorldLaw[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => isRecord(x) && x.id != null)
    .map((x) => ({ ...x, id: asString(x.id) }));
}

function normalizeThreads(raw: unknown): ThreadRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => isRecord(x) && x.id != null)
    .map((x) => ({ ...x, id: asString(x.id) }));
}

function normalizeHeat(raw: unknown): HeatState {
  const h = isRecord(raw) ? raw : {};
  return {
    ...h,
    level: asNumber(h.level, 0),
    response: asString(h.response, "none") || "none",
  };
}

function normalizeClock(raw: unknown): ClockState {
  const c = isRecord(raw) ? raw : {};
  return {
    ...c,
    turn: Math.max(1, Math.floor(asNumber(c.turn, 1))),
    time_of_day: c.time_of_day != null ? asString(c.time_of_day) : undefined,
  };
}

function normalizeStartingPlot(raw: unknown): StartingPlot | null {
  if (!isRecord(raw)) return null;
  return {
    ...raw,
    id: asString(raw.id),
  };
}

function normalizeRandomness(raw: unknown): RandomnessBible {
  const r = isRecord(raw) ? raw : {};
  return {
    ...r,
    chaos: asNumber(r.chaos, 4),
    cooldown_turns: asNumber(r.cooldown_turns, 0),
    last_event_turn:
      r.last_event_turn == null ? null : asNumber(r.last_event_turn, 0),
  };
}

function inferPlayerLocation(state: Record<string, unknown>): string {
  if (state.player_location != null && String(state.player_location).trim()) {
    return String(state.player_location);
  }
  const locs = Array.isArray(state.locations) ? state.locations : [];
  for (const loc of locs) {
    if (isRecord(loc) && loc.id != null) return String(loc.id);
  }
  const chars = Array.isArray(state.characters) ? state.characters : [];
  for (const c of chars) {
    if (isRecord(c) && c.location != null) return String(c.location);
  }
  return "unknown";
}

/** Empty / minimal factory. */
export function emptyWorldBible(): WorldBible {
  return normalizeWorldBible({
    world_type: "grounded",
    player_location: "unknown",
    locations: [],
    player: scaffoldPlayer(),
    characters: [],
    conditions: [],
    clock: { turn: 1 },
    heat: { level: 0, response: "none" },
    threads: [],
    laws: [],
    random_log: [],
  });
}

export function minimalWorldBible(): WorldBible {
  return emptyWorldBible();
}

/**
 * Coerce a raw STATE record into a typed WorldBible.
 * Guarantees bootstrap-critical fields (player sheet, location, clock).
 */
export function normalizeWorldBible(
  raw: Record<string, unknown> | null | undefined
): WorldBible {
  const ensured: Record<string, unknown> =
    raw && isRecord(raw) ? { ...raw } : {};

  if (!isRecord(ensured.player)) {
    ensured.player = scaffoldPlayer();
  }

  ensured.player_location = inferPlayerLocation(ensured);
  if (!Array.isArray(ensured.characters)) ensured.characters = [];
  if (!isRecord(ensured.clock)) ensured.clock = { turn: 1 };

  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ensured)) {
    if (!KNOWN_KEYS.has(k)) extras[k] = v;
  }

  return {
    world_type: normalizeWorldType(ensured.world_type),
    player_location: asString(ensured.player_location, "unknown") || "unknown",
    locations: normalizeLocations(ensured.locations),
    player: normalizePlayer(ensured.player),
    characters: normalizeCharacters(ensured.characters),
    laws: normalizeLaws(ensured.laws),
    heat: normalizeHeat(ensured.heat),
    clock: normalizeClock(ensured.clock),
    conditions: Array.isArray(ensured.conditions) ? ensured.conditions : [],
    threads: normalizeThreads(ensured.threads),
    starting_plot: normalizeStartingPlot(ensured.starting_plot),
    randomness: normalizeRandomness(ensured.randomness),
    random_log: Array.isArray(ensured.random_log) ? ensured.random_log : [],
    extras,
  };
}

/** Flatten bible back to a STATE-shaped record for rewrite/merge. */
export function worldBibleToRecord(bible: WorldBible): Record<string, unknown> {
  const {
    world_type,
    player_location,
    locations,
    player,
    characters,
    laws,
    heat,
    clock,
    conditions,
    threads,
    starting_plot,
    randomness,
    random_log,
    extras,
  } = bible;

  return {
    ...extras,
    world_type,
    player_location,
    locations,
    player,
    characters,
    laws,
    heat,
    clock,
    conditions,
    threads,
    starting_plot,
    randomness,
    random_log,
  };
}

function lastCanonicalFromHistory(
  history: ClientTurn[]
): Record<string, unknown> | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "assistant") continue;
    const s = extractStateJson(history[i].content);
    if (s && typeof s === "object") return s as Record<string, unknown>;
  }
  return null;
}

export function worldBibleFromHistory(
  history: ClientTurn[]
): WorldBible | null {
  const state = lastCanonicalFromHistory(history);
  if (!state) return null;
  return normalizeWorldBible(state);
}

/**
 * Prefer an in-session bible; fall back to parsing history.
 */
export function getBible(
  history: ClientTurn[],
  sessionBible?: WorldBible | null
): WorldBible | null {
  if (sessionBible) return sessionBible;
  return worldBibleFromHistory(history);
}
