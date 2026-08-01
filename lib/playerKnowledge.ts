/**
 * Progressive player knowledge of NPCs — what SCENE may reveal.
 *
 * Full truth (name, role, motives) lives on the character sheet in STATE.
 * SCENE may only use facts the player has earned via interaction.
 */

import { extractStateJson } from "@/lib/stateParse";

export type PlayerKnowledge = {
  /** Player has visually noticed this person. */
  seen: boolean;
  /** Player learned their proper name (intro, ask, badge, clear ID). */
  name_known: boolean;
  /** Player learned their job/role (told, badge, clear uniform evidence). */
  role_known: boolean;
  /** Player has spoken with them (any dialogue exchange). */
  talked: boolean;
  /** Player learned motives / personal history crumbs. */
  backstory_known: boolean;
};

export const EMPTY_PLAYER_KNOWLEDGE: PlayerKnowledge = {
  seen: false,
  name_known: false,
  role_known: false,
  talked: false,
  backstory_known: false,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function normalizePlayerKnowledge(raw: unknown): PlayerKnowledge {
  const o = isRecord(raw) ? raw : {};
  return {
    seen: o.seen === true,
    name_known: o.name_known === true,
    role_known: o.role_known === true,
    talked: o.talked === true,
    backstory_known: o.backstory_known === true,
  };
}

/** Pull knowledge from a character sheet; defaults all false. */
export function knowledgeFromCharacter(char: unknown): PlayerKnowledge {
  if (!isRecord(char)) return { ...EMPTY_PLAYER_KNOWLEDGE };
  if (char.player_knowledge != null) {
    return normalizePlayerKnowledge(char.player_knowledge);
  }
  // Legacy: known_to_player alone only implies seen, not name/role.
  if (char.known_to_player === true) {
    return { ...EMPTY_PLAYER_KNOWLEDGE, seen: true };
  }
  return { ...EMPTY_PLAYER_KNOWLEDGE };
}

export type KnowledgeLeak = {
  code: "premature_name" | "premature_role" | "premature_backstory";
  npcId: string;
  detail: string;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if SCENE contains a whole-word match for the name (case-insensitive). */
export function sceneMentionsName(scene: string, name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  // Prefer full name; also catch distinctive last/first tokens ≥3 chars.
  const parts = trimmed.split(/\s+/).filter((p) => p.length >= 3);
  const candidates = [trimmed, ...parts];
  for (const c of candidates) {
    const re = new RegExp(`\\b${escapeRegExp(c)}\\b`, "i");
    if (re.test(scene)) return true;
  }
  return false;
}

/** Role phrase match — only multi-word or distinctive job nouns. */
export function sceneMentionsRole(scene: string, role: string): boolean {
  const trimmed = role.trim();
  if (trimmed.length < 4) return false;
  // Skip ultra-generic roles that are also ordinary nouns in prose.
  if (/^(person|man|woman|guy|girl|stranger|civilian|passerby)$/i.test(trimmed)) {
    return false;
  }
  const re = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "i");
  return re.test(scene);
}

/**
 * Audit SCENE against characters[] player_knowledge.
 * Flags proper names / roles / backstory dumps used before earned.
 */
export function auditSceneKnowledge(
  scene: string | null | undefined,
  characters: unknown[] | null | undefined
): KnowledgeLeak[] {
  if (!scene || !characters?.length) return [];
  const leaks: KnowledgeLeak[] = [];

  for (const raw of characters) {
    if (!isRecord(raw) || raw.id == null) continue;
    const id = String(raw.id);
    const k = knowledgeFromCharacter(raw);
    const name = raw.name != null ? String(raw.name) : "";
    const role = raw.role != null ? String(raw.role) : "";

    if (name && !k.name_known && sceneMentionsName(scene, name)) {
      leaks.push({
        code: "premature_name",
        npcId: id,
        detail: `SCENE uses "${name}" before name_known`,
      });
    }

    if (role && !k.role_known && sceneMentionsRole(scene, role)) {
      leaks.push({
        code: "premature_role",
        npcId: id,
        detail: `SCENE uses role "${role}" before role_known`,
      });
    }

    // Backstory dump heuristic: personality/motive words when backstory unknown.
    if (!k.backstory_known && Array.isArray(raw.backstory_hints)) {
      for (const hint of raw.backstory_hints) {
        const h = String(hint ?? "").trim();
        if (h.length < 8) continue;
        // Match a distinctive 2+ word slice from the hint if present in SCENE.
        const slice = h.split(/[,.;]/)[0]?.trim() ?? "";
        if (slice.length >= 12 && scene.toLowerCase().includes(slice.toLowerCase())) {
          leaks.push({
            code: "premature_backstory",
            npcId: id,
            detail: `SCENE echoes backstory_hint before backstory_known`,
          });
          break;
        }
      }
    }
  }

  return leaks;
}

type PresentNpc = {
  id: string;
  name: string;
  role: string;
  knowledge: PlayerKnowledge;
};

function presentNpcs(state: Record<string, unknown>): PresentNpc[] {
  const loc =
    state.player_location != null ? String(state.player_location) : "";
  const chars = Array.isArray(state.characters) ? state.characters : [];
  const out: PresentNpc[] = [];
  for (const raw of chars) {
    if (!isRecord(raw) || raw.id == null) continue;
    const cloc = raw.location != null ? String(raw.location) : "";
    // Include co-located NPCs; if locations missing, include all with sheets.
    if (loc && cloc && cloc !== loc) continue;
    out.push({
      id: String(raw.id),
      name: raw.name != null ? String(raw.name) : String(raw.id),
      role: raw.role != null ? String(raw.role) : "",
      knowledge: knowledgeFromCharacter(raw),
    });
  }
  return out;
}

/**
 * Compact per-turn injection: what SCENE may say about present NPCs.
 * Empty string when no characters to gate.
 */
export function buildKnowledgePromptBlock(
  state: Record<string, unknown> | null | undefined
): string {
  if (!state) return "";
  const npcs = presentNpcs(state);
  if (npcs.length === 0) return "";

  const lines = [
    "[PLAYER KNOWLEDGE — server authoritative]",
    "SCENE may only use facts the player has earned. Full name/role/motives live in STATE.",
    "Present NPCs:",
  ];

  for (const n of npcs) {
    const k = n.knowledge;
    const flags = [
      `seen=${k.seen}`,
      `name_known=${k.name_known}`,
      `role_known=${k.role_known}`,
      `talked=${k.talked}`,
      `backstory_known=${k.backstory_known}`,
    ].join(" ");
    lines.push(`- ${n.id} (true name "${n.name}"${n.role ? `, role "${n.role}"` : ""}): ${flags}`);
    if (!k.name_known) {
      lines.push(
        `  BANNED in SCENE: proper name "${n.name}" (and name tokens). Use a physical stand-in only.`
      );
    }
    if (!k.role_known && n.role) {
      lines.push(
        `  BANNED in SCENE: job/role "${n.role}" unless a visible badge/uniform makes it obvious AND you set role_known true same turn.`
      );
    }
    if (!k.backstory_known) {
      lines.push(
        "  BANNED: personality dossier, motives, life story, 'whois' dumps. Earn via talk/ask."
      );
    }
    if (!k.seen && !k.talked) {
      lines.push(
        "  Not yet noticed — do not invent them into SCENE until the player looks/approaches or they interrupt."
      );
    }
  }

  lines.push(
    "Earn flags: look/notice → seen; approach+talk → talked; ask/hear/read name → name_known; ask job or clear badge → role_known; personal questions answered → backstory_known.",
    "whois / who is she: answer ONLY from earned flags. Unknown name → physical description, not the STATE name.",
    "Update characters[].player_knowledge in DELTA when flags flip."
  );

  return lines.join("\n");
}

/** Extract latest STATE record from assistant history (best-effort). */
export function extractLatestStateFromHistory(
  history: { role: string; content: string }[]
): Record<string, unknown> | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "assistant") continue;
    const s = extractStateJson(history[i].content);
    if (s && typeof s === "object" && !Array.isArray(s)) {
      return s as Record<string, unknown>;
    }
  }
  return null;
}
