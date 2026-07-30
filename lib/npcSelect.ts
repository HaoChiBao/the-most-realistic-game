/**
 * Location-aware NPC selection for combat / authority consequences.
 * Prefer who is actually in the fight over the highest-stat sheet in the registry.
 */

const AUTHORITY_ROLE_RE =
  /\b(officer|cop|police|deputy|sheriff|security|guard)\b/i;

const COMBAT_POSTURES = new Set([
  "alert",
  "defensive",
  "aggressive",
  "restraining_player",
  "calling_backup",
]);

/** SCENE language that implies armed authority is present right now. */
const ARMED_AUTHORITY_SCENE_RE =
  /\b(officer|cop|police|deputy|sheriff|security\s+guard|armed\s+guard)\b[^.]{0,80}\b(gun|holster|sidearm|firearm|pistol|weapon|draw)\b|\b(gun|holster|sidearm|firearm|pistol)\b[^.]{0,80}\b(officer|cop|police|deputy|sheriff)\b/i;

export type SelectableNpc = {
  id: string;
  name: string;
  role: string;
  location: string;
  archetype: string;
  authority_level: string;
  combat: number;
  firearms: number;
  training: string;
  disposition: string;
  combat_posture: string;
};

export type NpcPickOptions = {
  scene?: string | null;
  /** When false, never fall back to global registry (lethal / first-assault). */
  allowGlobalFallback?: boolean;
};

function readStat(stats: unknown, key: string, fallback: number): number {
  if (!stats || typeof stats !== "object") return fallback;
  const v = (stats as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function playerLocationOf(
  state: Record<string, unknown> | null | undefined
): string {
  if (!state) return "";
  return state.player_location != null ? String(state.player_location) : "";
}

export function parseSelectableNpcs(
  state: Record<string, unknown> | null | undefined
): SelectableNpc[] {
  if (!state) return [];
  const raw = Array.isArray(state.characters) ? state.characters : [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      id: String(c.id ?? ""),
      name: String(c.name ?? c.id ?? "npc"),
      role: String(c.role ?? ""),
      location: c.location != null ? String(c.location) : "",
      archetype: String(c.archetype ?? ""),
      authority_level: String(c.authority_level ?? "none"),
      combat: readStat(c.stats, "combat", 30),
      firearms: readStat(c.stats, "firearms", 50),
      training: String(c.training ?? "basic"),
      disposition: String(c.disposition ?? "neutral"),
      combat_posture: String(c.combat_posture ?? "relaxed"),
    }))
    .filter((c) => c.id && c.id !== "player");
}

export function isAuthorityNpc(npc: SelectableNpc): boolean {
  if (AUTHORITY_ROLE_RE.test(npc.role)) return true;
  if (npc.archetype.toLowerCase() === "authority") return true;
  const level = npc.authority_level.toLowerCase();
  if (level === "medium" || level === "high") return true;
  return false;
}

export function sceneMentionsNpc(
  scene: string | null | undefined,
  npc: SelectableNpc
): boolean {
  if (!scene) return false;
  const hay = scene.toLowerCase();
  if (npc.name && npc.name.length >= 2 && hay.includes(npc.name.toLowerCase())) {
    return true;
  }
  // Role noun cue (e.g. "the officer", "a security guard")
  const roleWord = npc.role.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (roleWord.length >= 3 && AUTHORITY_ROLE_RE.test(roleWord)) {
    return new RegExp(`\\b${roleWord}\\b`, "i").test(scene);
  }
  return false;
}

export function sceneHasArmedAuthority(
  scene: string | null | undefined
): boolean {
  if (!scene) return false;
  return ARMED_AUTHORITY_SCENE_RE.test(scene);
}

function atPlayerLocation(
  npc: SelectableNpc,
  playerLoc: string
): boolean {
  if (!playerLoc || !npc.location) return false;
  return npc.location === playerLoc;
}

function isHostileCombatant(npc: SelectableNpc): boolean {
  return (
    npc.disposition === "hostile" ||
    COMBAT_POSTURES.has(npc.combat_posture) ||
    /guard|officer|cop|security|bouncer/i.test(npc.role)
  );
}

function pickFromPools(
  pools: SelectableNpc[][],
  score: (n: SelectableNpc) => number
): SelectableNpc | null {
  for (const pool of pools) {
    if (pool.length === 0) continue;
    return [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
  }
  return null;
}

/**
 * Prefer NPCs at player_location, then hostile/mentioned, then global.
 */
export function pickCombatNpc(
  state: Record<string, unknown> | null | undefined,
  opts: NpcPickOptions = {}
): SelectableNpc | null {
  const npcs = parseSelectableNpcs(state);
  if (npcs.length === 0) return null;

  const playerLoc = playerLocationOf(state);
  const scene = opts.scene ?? null;
  const allowGlobal = opts.allowGlobalFallback !== false;

  const local = npcs.filter((n) => atPlayerLocation(n, playerLoc));
  const localHostile = local.filter(isHostileCombatant);
  const mentioned = npcs.filter((n) => sceneMentionsNpc(scene, n));
  const mentionedHostile = mentioned.filter(isHostileCombatant);
  const globalHostile = npcs.filter(isHostileCombatant);

  const pools: SelectableNpc[][] = [
    localHostile,
    local,
    mentionedHostile,
    mentioned,
  ];
  if (allowGlobal) {
    pools.push(globalHostile, npcs);
  }

  return pickFromPools(pools, (n) => n.combat);
}

/**
 * Prefer authority at player_location / mentioned in SCENE.
 * Global registry only when allowGlobalFallback is true.
 */
export function pickAuthorityNpc(
  state: Record<string, unknown> | null | undefined,
  opts: NpcPickOptions = {}
): SelectableNpc | null {
  const npcs = parseSelectableNpcs(state).filter(isAuthorityNpc);
  if (npcs.length === 0) return null;

  const playerLoc = playerLocationOf(state);
  const scene = opts.scene ?? null;
  const allowGlobal = opts.allowGlobalFallback !== false;

  const local = npcs.filter((n) => atPlayerLocation(n, playerLoc));
  const mentioned = npcs.filter((n) => sceneMentionsNpc(scene, n));

  const pools: SelectableNpc[][] = [local, mentioned];
  if (allowGlobal) pools.push(npcs);

  return pickFromPools(pools, (n) => n.firearms);
}

/** True when an authority target is fair for lethal force this turn. */
export function resolveLethalAuthorityTarget(
  state: Record<string, unknown> | null | undefined,
  scene: string | null | undefined
): SelectableNpc | null {
  // Location / mention only — never invent "the officer" from a distant sheet.
  const present = pickAuthorityNpc(state, {
    scene,
    allowGlobalFallback: false,
  });
  if (present) return present;

  // SCENE clearly has armed authority, but sheets lack location — allow
  // registry authority only when SCENE also cues armed authority.
  if (sceneHasArmedAuthority(scene)) {
    return pickAuthorityNpc(state, {
      scene,
      allowGlobalFallback: true,
    });
  }

  return null;
}
