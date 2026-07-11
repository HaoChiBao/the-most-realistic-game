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
  const merged = prev
    ? mergeDeltaState(prev, delta as Record<string, unknown>)
    : (delta as Record<string, unknown>);

  return rewriteWorldState(rawContent, merged);
}
