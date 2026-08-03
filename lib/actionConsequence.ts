import type { ClientTurn } from "@/lib/gameMessages";
import { resolveCombatEscalation } from "@/lib/combatContext";
import {
  pickAuthorityNpc,
  resolveLethalAuthorityTarget,
  type SelectableNpc,
} from "@/lib/npcSelect";
import { extractSceneBlock, extractStateJson } from "@/lib/stateParse";

const ATTACK_RE =
  /\b(tackle|attack|punch|punches|punching|box|boxing|hit|hitting|kick|stab|shoot|shooting|fight|assault|throw|throwing|bash|beat|wrestle|grapple|choke|burn|ignite)\b/i;

const WAIT_RE = /\b(wait|keep waiting|hold on|stay still)\b/i;

const RESTRAINT_LABEL_RE = /\b(cuff|cuffed|handcuff|restrain|restrained|pin|pinned)\b/i;

const RESTRAINT_SCENE_RE =
  /\b(cuff|cuffed|handcuff|restrain|restrained|pinned|face down|cannot move|held firm)\b/i;

function isLethalRashAction(action: string): boolean {
  if (/\b(shoot|gun down|kill)\b/i.test(action)) return true;
  if (
    /\b(reach|grab|take|pull|snatch|wrestle|tackle)\b/i.test(action) &&
    /\b(gun|weapon|holster|firearm|pistol|sidearm)\b/i.test(action)
  ) {
    return true;
  }
  if (
    /\b(burn|ignite|set fire|lighter|flame)\b/i.test(action) &&
    /\b(officer|cop|guard|mills|him|her)\b/i.test(action)
  ) {
    return true;
  }
  return false;
}

export type ActionConsequenceResult = {
  kind: "lethal" | "authority" | "combat" | "detention";
  fired: boolean;
  prompt_block: string;
  debug?: Record<string, unknown>;
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

function countRecent(
  history: ClientTurn[],
  re: RegExp,
  window = 12
): number {
  let n = 0;
  for (const t of history.slice(-window)) {
    if (t.role === "user" && re.test(t.content)) n++;
  }
  return n;
}

/**
 * Detention / cuff timer only — not mobility trauma.
 * Restrained when kind === "restraint" OR label matches cuff/pin/restrain.
 * Do NOT treat gates:["sprint"] alone as detention.
 */
export function playerRestrained(
  state: Record<string, unknown> | null,
  scene: string | null
): boolean {
  if (scene && RESTRAINT_SCENE_RE.test(scene)) return true;

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

function resolveLethalConsequence(
  action: string,
  npc: SelectableNpc | null
): ActionConsequenceResult | null {
  if (!isLethalRashAction(action)) return null;
  // No present authority target → skip (combat escalation may still apply).
  if (!npc) return null;

  return {
    kind: "lethal",
    fired: true,
    debug: { target: npc.id, action },
    prompt_block: `[LETHAL CONSEQUENCE — server authoritative]
Player attempted lethal/rash violence against armed authority (${action}).
Target: ${npc.name} (${npc.id}). Grounded world — this is NOT survivable comedy.
MANDATORY THIS TURN:
- Officer uses lethal force (draw + fire) OR fight-ending incapacitation before player acts.
- Player: torso/head trauma, hp near 0, conscious false, alive false if shot center mass.
- Hard end: <ENDLABEL>SHOT BY POLICE</ENDLABEL><END> unless already dead from prior wounds.
- heat.level max, consequences flag lethal_assault_on_officer.
SCENE: blunt, immediate, 1-2 sentences. NO meta brackets. NO plot smells. NO "you could try".
STATE: update body, player.alive, characters[].memory, heat.`,
  };
}

function resolveAuthorityResponse(
  action: string,
  npc: SelectableNpc | null,
  attackCount: number
): ActionConsequenceResult | null {
  if (!ATTACK_RE.test(action) || !npc) return null;
  if (attackCount > 1) return null;

  return {
    kind: "authority",
    fired: true,
    debug: { target: npc.id, attackCount },
    prompt_block: `[AUTHORITY RESPONSE — server authoritative]
Player attacked uniformed authority on first assault (${action}).
Target: ${npc.name} (${npc.id}) firearms=${npc.firearms}.
MANDATORY THIS TURN (immediate — no trading blows):
- Officer wins contact: cuffs/restraint condition on player, combat_posture restraining_player.
- heat.level +40, witnesses true, heat.response = backup_en_route, timeline beat backup_arrives in 1-2 turns.
- Player cannot freely attack again without severe consequence next turn.
SCENE: subdual happens NOW. BANNED: extended brawl, muddy footprints, rubber smells, plot hooks.
NO meta text like [SCENE continues] or server block echoes in [SCENE].`,
  };
}

function resolveDetentionTimer(
  history: ClientTurn[],
  state: Record<string, unknown> | null,
  scene: string | null,
  npc: SelectableNpc | null
): ActionConsequenceResult | null {
  if (!WAIT_RE.test(lastUserAction(history))) return null;
  if (!playerRestrained(state, scene)) return null;

  const waitCount = countRecent(history, WAIT_RE, 8);
  if (waitCount < 2) return null;

  const heat =
    state?.heat && typeof state.heat === "object"
      ? (state.heat as Record<string, unknown>)
      : null;
  const response = heat ? String(heat.response ?? "none") : "none";

  return {
    kind: "detention",
    fired: true,
    debug: { waitCount, heat_response: response },
    prompt_block: `[DETENTION TIMER — server authoritative]
Player detained ${waitCount}+ wait turns — stasis FORBIDDEN.
${npc ? `Detaining officer: ${npc.name} (${npc.id}).` : "Authority present."}
MANDATORY THIS TURN — pick ONE concrete event (not "tension hangs"):
- Backup arrives NOW (1-2 units): player caged in squad car OR walked to station (new location_id).
- OR player dragged into building for processing if backup already en route (${response}).
- Advance clock + timeline; heat.response escalates if not already manhunt.
SCENE: sirens close, doors open, new voices — immediate sensory change.
BANNED: "time passes", "uneventful", "nothing happens", random smells/footprints.`,
  };
}

export type ActionConsequenceOptions = {
  seedCode?: string | null;
};

/**
 * Highest-priority server injection for rash violence, authority contact,
 * combat loops, and detention stasis.
 */
export function resolveActionConsequence(
  history: ClientTurn[],
  opts: ActionConsequenceOptions = {}
): ActionConsequenceResult | null {
  const action = lastUserAction(history);
  if (!action) return null;

  const lastRaw = lastAssistantRaw(history);
  const state = lastRaw ? extractStateJson(lastRaw) : null;
  const s =
    state && typeof state === "object" ? (state as Record<string, unknown>) : null;
  const scene = lastRaw ? extractSceneBlock(lastRaw) : null;

  // Lethal / first-assault: must be co-located or SCENE-mentioned — not a
  // distant registry officer.
  const lethalTarget = resolveLethalAuthorityTarget(s, scene);
  const presentAuthority = pickAuthorityNpc(s, {
    scene,
    allowGlobalFallback: false,
  });
  // Detention naming can fall back globally once already restrained.
  const detentionAuthority = pickAuthorityNpc(s, {
    scene,
    allowGlobalFallback: true,
  });
  const attackCount = countRecent(history, ATTACK_RE, 12);

  const lethal = resolveLethalConsequence(action, lethalTarget);
  if (lethal) return lethal;

  if (presentAuthority) {
    const authority = resolveAuthorityResponse(
      action,
      presentAuthority,
      attackCount
    );
    if (authority) return authority;
  }

  const combat = resolveCombatEscalation(history, { seedCode: opts.seedCode });
  if (combat?.fired) {
    return {
      kind: "combat",
      fired: true,
      debug: {
        attack_streak: combat.attack_streak,
        passive_last_scene: combat.passive_last_scene,
        target: combat.target_npc_id,
        outcome: combat.outcome,
        combat_roll: combat.resolve?.roll,
      },
      prompt_block: combat.prompt_block,
    };
  }

  const detention = resolveDetentionTimer(
    history,
    s,
    scene,
    detentionAuthority
  );
  if (detention) return detention;

  return null;
}
