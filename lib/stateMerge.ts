import type { ClientTurn } from "@/lib/gameMessages";
import { extractStateJson } from "@/lib/stateParse";

const KEYED_ARRAY_KEYS = [
  "characters",
  "locations",
  "laws",
  "threads",
  "consequences",
  "end_clauses",
  "conditions",
] as const;

const APPEND_ARRAY_KEYS = [
  "random_log",
  "timeline",
  "ambient_hooks",
  "noticed_before",
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export const DEFAULT_PLAYER_BODY: Record<string, string> = {
  head: "ok",
  torso: "ok",
  left_arm: "ok",
  right_arm: "ok",
  left_leg: "ok",
  right_leg: "ok",
};

export const DEFAULT_PLAYER_STATS: Record<string, number> = {
  hp: 100,
  stamina: 80,
  pain: 0,
  combat: 20,
  firearms: 15,
  awareness: 40,
  composure: 50,
  mobility: 100,
};

/** Minimal player sheet used when Phase A omits or truncates `player`. */
export function defaultPlayerSheet(): Record<string, unknown> {
  return {
    id: "player",
    inventory: [],
    body: { ...DEFAULT_PLAYER_BODY },
    stats: { ...DEFAULT_PLAYER_STATS },
    abilities: [],
    traits: [],
    flags: [],
    conditions: [],
    conscious: true,
    alive: true,
  };
}

/** Scaffold so sparse hydration deltas cannot become the whole world alone. */
export function minimalBootstrapState(): Record<string, unknown> {
  return {
    world_type: "grounded",
    player_location: "unknown",
    locations: [],
    player: defaultPlayerSheet(),
    characters: [],
    conditions: [],
    clock: { turn: 1 },
    heat: { level: 0, response: "none" },
    active_track: "starting",
    threads: [],
    laws: [],
    consequences: [],
    random_log: [],
    noticed_before: [],
  };
}

function inferPlayerLocation(state: Record<string, unknown>): void {
  if (state.player_location != null && String(state.player_location).trim()) {
    return;
  }
  const locs = Array.isArray(state.locations) ? state.locations : [];
  for (const loc of locs) {
    if (isRecord(loc) && loc.id != null) {
      state.player_location = String(loc.id);
      return;
    }
  }
  const chars = Array.isArray(state.characters) ? state.characters : [];
  for (const c of chars) {
    if (isRecord(c) && c.location != null) {
      state.player_location = String(c.location);
      return;
    }
  }
}

/**
 * Guarantee bootstrap-critical fields survive merges.
 * Hydration / turn deltas are allowed to omit unchanged keys — never wipe player.
 */
export function ensureBootstrapFields(
  state: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...state };

  if (!isRecord(out.player)) {
    out.player = defaultPlayerSheet();
  } else {
    const p: Record<string, unknown> = { ...out.player };
    if (p.id == null) p.id = "player";
    p.body = {
      ...DEFAULT_PLAYER_BODY,
      ...(isRecord(p.body) ? p.body : {}),
    };
    p.stats = {
      ...DEFAULT_PLAYER_STATS,
      ...(isRecord(p.stats) ? p.stats : {}),
    };
    if (!Array.isArray(p.inventory)) p.inventory = [];
    if (!Array.isArray(p.conditions)) p.conditions = [];
    if (typeof p.alive !== "boolean") p.alive = true;
    if (typeof p.conscious !== "boolean") p.conscious = true;
    out.player = p;
  }

  inferPlayerLocation(out);
  if (out.player_location == null || !String(out.player_location).trim()) {
    out.player_location = "unknown";
  }
  if (!Array.isArray(out.characters)) out.characters = [];
  if (!isRecord(out.clock)) out.clock = { turn: 1 };

  return out;
}

export function stateHasPlayer(state: unknown): boolean {
  return isRecord(state) && isRecord(state.player);
}

function itemId(item: Record<string, unknown>, idKey: string): string {
  const id = item[idKey];
  return id !== undefined && id !== null ? String(id) : "";
}

function mergeKeyedArray(
  base: unknown[],
  delta: unknown[],
  idKey: string
): unknown[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of base) {
    if (!isRecord(item)) continue;
    const id = itemId(item, idKey);
    if (id) byId.set(id, { ...item });
  }
  for (const item of delta) {
    if (!isRecord(item)) continue;
    const id = itemId(item, idKey);
    if (!id) continue;
    const existing = byId.get(id);
    if (existing) {
      const merged = mergeDeltaState(existing, item);
      if (Array.isArray(item.memory) && Array.isArray(existing.memory)) {
        merged.memory = appendArray(existing.memory, item.memory);
      }
      if (Array.isArray(item.conditions) && Array.isArray(existing.conditions)) {
        merged.conditions = mergeKeyedArray(
          existing.conditions,
          item.conditions,
          "id"
        );
      }
      byId.set(id, merged);
    } else {
      byId.set(id, { ...item });
    }
  }
  return Array.from(byId.values());
}

function appendArray(base: unknown[], delta: unknown[]): unknown[] {
  const out = [...base];
  for (const item of delta) {
    const key = JSON.stringify(item);
    if (!out.some((x) => JSON.stringify(x) === key)) out.push(item);
  }
  return out;
}

function mergePlayer(
  base: Record<string, unknown>,
  delta: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base, ...delta };
  if (isRecord(base.body) || isRecord(delta.body)) {
    out.body = { ...(isRecord(base.body) ? base.body : {}), ...(isRecord(delta.body) ? delta.body : {}) };
  }
  if (isRecord(base.stats) || isRecord(delta.stats)) {
    out.stats = { ...(isRecord(base.stats) ? base.stats : {}), ...(isRecord(delta.stats) ? delta.stats : {}) };
  }
  if (Array.isArray(delta.inventory)) {
    out.inventory = mergeKeyedArray(
      Array.isArray(base.inventory) ? base.inventory : [],
      delta.inventory,
      "id"
    );
  }
  if (Array.isArray(delta.conditions)) {
    out.conditions = mergeKeyedArray(
      Array.isArray(base.conditions) ? base.conditions : [],
      delta.conditions,
      "id"
    );
  }
  return out;
}

/** Deep-merge a delta STATE patch onto the prior canonical STATE. */
export function mergeDeltaState(
  base: Record<string, unknown>,
  delta: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };

  for (const [key, deltaVal] of Object.entries(delta)) {
    if (deltaVal === undefined) continue;
    const baseVal = base[key];

    if (
      (KEYED_ARRAY_KEYS as readonly string[]).includes(key) &&
      Array.isArray(deltaVal)
    ) {
      out[key] = mergeKeyedArray(
        Array.isArray(baseVal) ? baseVal : [],
        deltaVal,
        "id"
      );
      continue;
    }

    if (
      (APPEND_ARRAY_KEYS as readonly string[]).includes(key) &&
      Array.isArray(deltaVal)
    ) {
      out[key] = appendArray(Array.isArray(baseVal) ? baseVal : [], deltaVal);
      continue;
    }

    if (key === "player" && isRecord(deltaVal)) {
      out[key] = mergePlayer(isRecord(baseVal) ? baseVal : {}, deltaVal);
      continue;
    }

    if (isRecord(deltaVal) && isRecord(baseVal)) {
      out[key] = mergeDeltaState(baseVal, deltaVal);
      continue;
    }

    out[key] = deltaVal;
  }

  return out;
}

export function compactStateJson(state: Record<string, unknown>): string {
  return JSON.stringify(state);
}

function findJsonObjectEnd(src: string, braceStart: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Replace STATE JSON inside a raw assistant message with merged canonical state. */
export function rewriteWorldState(
  raw: string,
  state: Record<string, unknown>
): string {
  const worldM = raw.match(/\[\s*WORLD\s*\]/i);
  if (!worldM || worldM.index === undefined) return raw;

  const head = raw.slice(0, worldM.index + worldM[0].length);
  const tail = raw.slice(worldM.index + worldM[0].length);
  const stateLine = tail.match(/^\s*STATE\s*\n/i);
  const jsonLine = compactStateJson(state);

  if (!stateLine) {
    return `${head}\nSTATE\n${jsonLine}`;
  }

  const afterState = tail.slice(stateLine[0].length);
  const brace = afterState.indexOf("{");
  if (brace === -1) {
    return `${head}\nSTATE\n${jsonLine}`;
  }

  const jsonEnd = findJsonObjectEnd(afterState, brace);
  const trailing = jsonEnd >= 0 ? afterState.slice(jsonEnd) : "";
  return `${head}\nSTATE\n${jsonLine}${trailing}`;
}

export function getLastCanonicalState(
  history: ClientTurn[]
): Record<string, unknown> | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "assistant") continue;
    const s = extractStateJson(history[i].content);
    if (s && typeof s === "object") return s as Record<string, unknown>;
  }
  return null;
}

/**
 * Merge streamed delta STATE into canonical form and rewrite [WORLD] before
 * storing in session history.
 */
export function resolveCanonicalAssistantContent(
  history: ClientTurn[],
  rawContent: string
): string {
  const delta = extractStateJson(rawContent);
  if (!delta || typeof delta !== "object") return rawContent;

  const prev = getLastCanonicalState(history);
  // Never accept a sparse delta as the whole world when prior STATE is missing —
  // that drops bootstrap `player` the same way a bad hydration merge does.
  const base = prev ?? minimalBootstrapState();
  const merged = ensureBootstrapFields(
    mergeDeltaState(base, delta as Record<string, unknown>)
  );

  return rewriteWorldState(rawContent, merged);
}

/**
 * Merge a background hydration delta into the Phase A opening assistant turn.
 * Hydration is sparse by design (omits unchanged keys). Never replace an
 * unparseable Phase A bootstrap with the hydrate delta alone.
 */
export function mergeHydrationIntoOpening(
  openingContent: string,
  hydrationRaw: string
): string {
  const delta = extractStateJson(hydrationRaw);
  if (!delta || typeof delta !== "object") return openingContent;

  const prev = extractStateJson(openingContent);
  const base =
    prev && typeof prev === "object"
      ? (prev as Record<string, unknown>)
      : minimalBootstrapState();
  const merged = ensureBootstrapFields(
    mergeDeltaState(base, delta as Record<string, unknown>)
  );

  return rewriteWorldState(openingContent, merged);
}
