import type { ClientTurn } from "@/lib/gameMessages";
import { extractSceneBlock, extractStateJson } from "@/lib/stateParse";

const ATTACK_RE =
  /\b(tackle|tackling|attack|attacking|punch|punches|punching|box|boxing|hit|hitting|kick|kicking|stab|shoot|fight|fighting|assault|throw|throwing|swing|bash|beat|slug|smash|strike|wrestle|grapple|choke|headbutt)\b/i;

const TAUNT_RE =
  /\b(taunt|pussy|coward|bitch|weak|loser|scared|fight back|come at me|do something)\b/i;

/** Passive fight narration the engine must not repeat. */
const PASSIVE_SCENE_RE =
  /\b(ready to respond|looks ready|hesitant|cautious|doesn'?t rush|prepares to push back|blocks some|raises (his|her|their) hands defensively|still wary|narrowed,? but)\b/i;

const COMBAT_POSTURES = new Set([
  "alert",
  "defensive",
  "aggressive",
  "restraining_player",
  "calling_backup",
]);

export type CombatEscalationResult = {
  fired: boolean;
  attack_streak: number;
  passive_last_scene: boolean;
  target_npc_id: string | null;
  target_npc_name: string | null;
  player_combat: number;
  npc_combat: number;
  prompt_block: string;
};

type NpcSlice = {
  id: string;
  name: string;
  role: string;
  combat: number;
  training: string;
  disposition: string;
  combat_posture: string;
};

function lastUserAction(history: ClientTurn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return history[i].content;
  }
  return "";
}

function lastAssistantRaw(history: ClientTurn[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") return history[i].content;
  }
  return null;
}

function countRecentAttackTurns(history: ClientTurn[], window = 10): number {
  let count = 0;
  for (const t of history.slice(-window)) {
    if (t.role === "user" && ATTACK_RE.test(t.content)) count++;
  }
  return count;
}

function numStat(stats: unknown, key: string, fallback: number): number {
  if (!stats || typeof stats !== "object") return fallback;
  const v = (stats as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function pickCombatNpc(state: Record<string, unknown>): NpcSlice | null {
  const raw = Array.isArray(state.characters) ? state.characters : [];
  const npcs: NpcSlice[] = raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      id: String(c.id ?? ""),
      name: String(c.name ?? c.id ?? "npc"),
      role: String(c.role ?? ""),
      combat: numStat(c.stats, "combat", 30),
      training: String(c.training ?? "basic"),
      disposition: String(c.disposition ?? "neutral"),
      combat_posture: String(c.combat_posture ?? "relaxed"),
    }))
    .filter((c) => c.id && c.id !== "player");

  if (npcs.length === 0) return null;

  const hostile = npcs.filter(
    (n) =>
      n.disposition === "hostile" ||
      COMBAT_POSTURES.has(n.combat_posture) ||
      /guard|officer|cop|security|bouncer/i.test(n.role)
  );
  const pool = hostile.length > 0 ? hostile : npcs;
  return pool.sort((a, b) => b.combat - a.combat)[0];
}

/**
 * When the player is mid-assault, inject a hard mandate so trained NPCs
 * actually end the fight instead of stalling with passive blocking.
 */
export function resolveCombatEscalation(
  history: ClientTurn[]
): CombatEscalationResult | null {
  const action = lastUserAction(history);
  if (!action) return null;

  const attackStreak = countRecentAttackTurns(history);
  const isAttack = ATTACK_RE.test(action);
  const isTaunt = TAUNT_RE.test(action);

  const lastRaw = lastAssistantRaw(history);
  const lastScene = lastRaw ? extractSceneBlock(lastRaw) : null;
  const passiveLastScene = lastScene ? PASSIVE_SCENE_RE.test(lastScene) : false;

  const state = lastRaw ? extractStateJson(lastRaw) : null;
  const s = state && typeof state === "object" ? (state as Record<string, unknown>) : null;
  const npc = s ? pickCombatNpc(s) : null;

  const stateInCombat =
    !!npc &&
    (npc.disposition === "hostile" ||
      COMBAT_POSTURES.has(npc.combat_posture) ||
      /guard|officer|cop|security|bouncer/i.test(npc.role));

  const isAuthority =
    !!npc && /officer|cop|police|deputy|sheriff|security|guard/i.test(npc.role);

  const shouldFire =
    (isAuthority && attackStreak >= 2 && (isAttack || isTaunt)) ||
    (isAuthority && isAttack && attackStreak >= 1 && passiveLastScene) ||
    attackStreak >= 3 ||
    (attackStreak >= 2 && (isAttack || isTaunt)) ||
    (attackStreak >= 1 && passiveLastScene && (isAttack || isTaunt)) ||
    (stateInCombat && passiveLastScene && (isAttack || isTaunt || action.length < 80));

  if (!shouldFire) return null;

  const playerCombat = numStat(
    s?.player && typeof s.player === "object"
      ? (s.player as Record<string, unknown>).stats
      : null,
    "combat",
    20
  );
  const npcCombat = npc?.combat ?? 45;
  const npcTraining = npc?.training ?? "professional";
  const npcName = npc?.name ?? "the guard";
  const npcId = npc?.id ?? "active_npc";

  const mandatory =
    npcCombat >= playerCombat + 15 ||
    npcTraining === "professional" ||
    npcTraining === "elite"
      ? "NPC MUST win this turn: takedown + restraint on player, OR knockout (conscious false), OR drag to security_office/holding_cell. Update player_location if relocated."
      : "NPC MUST counter decisively this turn — fight back, injure, flee, or call backup. No passive blocking.";

  const prompt_block = `[COMBAT ESCALATION — server authoritative]
Active assault in progress (${attackStreak} attack turns recent; last scene was ${
    passiveLastScene ? "PASSIVE — forbidden to repeat" : "not yet resolved"
  }).
Target: ${npcName} (${npcId}) training=${npcTraining} combat=${npcCombat} vs player combat=${playerCombat}.
${mandatory}
SCENE rules this turn:
- Narrate the NPC physically fighting back or ending the fight. BANNED phrases: "ready to respond", "hesitant", "blocks some", "prepares to push back", "raises hands defensively", "doesn't rush in".
- ZERO plot nudges: no new smoke smells, murmurs, coffee, mysteries, or thread hooks unless the player explicitly walks away from the fight.
- If the player asks a question mid-fight, the NPC answers briefly while fighting OR ignores it — do not pivot to environmental discovery.
- Update characters[].combat_posture, memory[], player body/stats/conditions, heat in STATE.`;

  return {
    fired: true,
    attack_streak: attackStreak,
    passive_last_scene: passiveLastScene,
    target_npc_id: npcId,
    target_npc_name: npcName,
    player_combat: playerCombat,
    npc_combat: npcCombat,
    prompt_block,
  };
}
