import type { ClientTurn } from "@/lib/gameMessages";
import { pickCombatNpc } from "@/lib/npcSelect";
import { extractSceneBlock, extractStateJson } from "@/lib/stateParse";
import {
  resolveCombatOutcome,
  tagCombatAction,
  type CombatOutcome,
  type CombatResolveResult,
} from "@/lib/combatResolve";

const ATTACK_RE =
  /\b(tackle|tackling|attack|attacking|punch|punches|punching|box|boxing|hit|hitting|kick|kicking|stab|shoot|fight|fighting|assault|throw|throwing|swing|bash|beat|slug|smash|strike|wrestle|grapple|choke|headbutt)\b/i;

const TAUNT_RE =
  /\b(taunt|pussy|coward|bitch|weak|loser|scared|fight back|come at me|do something)\b/i;

const FLEE_RE =
  /\b(flee|run\s+away|run\s+for|sprint\s+away|bolt|escape|get\s+away|leg\s*it|retreat|back\s+off|break\s+away)\b/i;

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
  outcome: CombatOutcome | null;
  resolve: CombatResolveResult | null;
  prompt_block: string;
};

export type CombatEscalationOptions = {
  seedCode?: string | null;
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

function clockTurn(state: Record<string, unknown> | null): number {
  const clock =
    state?.clock && typeof state.clock === "object"
      ? (state.clock as Record<string, unknown>)
      : null;
  const turn = clock?.turn;
  return typeof turn === "number" && Number.isFinite(turn) ? turn : 1;
}

function heatLevel(state: Record<string, unknown> | null): number {
  const heat =
    state?.heat && typeof state.heat === "object"
      ? (state.heat as Record<string, unknown>)
      : null;
  const level = heat?.level;
  return typeof level === "number" && Number.isFinite(level) ? level : 0;
}

const RESTRAINT_LABEL_RE = /\b(cuff|cuffed|handcuff|restrain|restrained|pin|pinned)\b/i;

/** Local copy — avoid importing actionConsequence (circular). */
function isPlayerRestrained(
  state: Record<string, unknown> | null,
  scene: string | null
): boolean {
  if (scene && /\b(cuff|cuffed|handcuff|restrain|restrained|pinned)\b/i.test(scene)) {
    return true;
  }
  if (!state?.player || typeof state.player !== "object") return false;
  const player = state.player as Record<string, unknown>;
  const conds = Array.isArray(player.conditions) ? player.conditions : [];
  for (const c of conds) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (o.progress === "resolved") continue;
    if (o.kind === "restraint") return true;
    if (RESTRAINT_LABEL_RE.test(String(o.label ?? ""))) return true;
  }
  return false;
}

/**
 * When the player is mid-assault (or fleeing an active fight), inject a
 * structured combat outcome envelope so trained NPCs end the fight instead
 * of stalling with passive blocking.
 */
export function resolveCombatEscalation(
  history: ClientTurn[],
  opts: CombatEscalationOptions = {}
): CombatEscalationResult | null {
  const action = lastUserAction(history);
  if (!action) return null;

  const attackStreak = countRecentAttackTurns(history);
  const isAttack = ATTACK_RE.test(action);
  const isTaunt = TAUNT_RE.test(action);
  const isFlee = FLEE_RE.test(action);
  const tags = tagCombatAction(action);

  const lastRaw = lastAssistantRaw(history);
  const lastScene = lastRaw ? extractSceneBlock(lastRaw) : null;
  const passiveLastScene = lastScene ? PASSIVE_SCENE_RE.test(lastScene) : false;

  const state = lastRaw ? extractStateJson(lastRaw) : null;
  const s = state && typeof state === "object" ? (state as Record<string, unknown>) : null;
  // Prefer co-located / mentioned NPCs; global registry only as last resort.
  const npc = pickCombatNpc(s, { scene: lastScene, allowGlobalFallback: true });

  const stateInCombat =
    !!npc &&
    (npc.disposition === "hostile" ||
      COMBAT_POSTURES.has(npc.combat_posture) ||
      /guard|officer|cop|security|bouncer/i.test(npc.role));

  const isAuthority =
    !!npc && /officer|cop|police|deputy|sheriff|security|guard/i.test(npc.role);

  // Flee mid-fight: still fire so the envelope becomes player_flees (not cuff).
  const fleeFromFight =
    isFlee && (attackStreak >= 1 || stateInCombat || passiveLastScene);

  const shouldFire =
    fleeFromFight ||
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

  const resolve = resolveCombatOutcome({
    action,
    tags,
    playerCombat,
    playerRestrained: isPlayerRestrained(s, lastScene),
    npc: npc ?? {
      id: npcId,
      name: npcName,
      role: "guard",
      combat: npcCombat,
      firearms: 40,
      training: npcTraining,
      archetype: "civilian",
      authority_level: "none",
    },
    isAuthority,
    heatLevel: heatLevel(s),
    attackStreak,
    seedCode: opts.seedCode,
    turn: clockTurn(s),
  });

  return {
    fired: true,
    attack_streak: attackStreak,
    passive_last_scene: passiveLastScene,
    target_npc_id: npcId,
    target_npc_name: npcName,
    player_combat: playerCombat,
    npc_combat: npcCombat,
    outcome: resolve.outcome,
    resolve,
    prompt_block: resolve.prompt_block,
  };
}
