import type { ClientTurn } from "@/lib/gameMessages";
import { resolveCombatEscalation } from "@/lib/combatContext";
import { extractSceneBlock, extractStateJson } from "@/lib/stateParse";

const ATTACK_RE =
  /\b(tackle|attack|punch|punches|punching|box|boxing|hit|hitting|kick|stab|shoot|shooting|fight|assault|throw|throwing|bash|beat|wrestle|grapple|choke|burn|ignite)\b/i;

const WAIT_RE = /\b(wait|keep waiting|hold on|stay still)\b/i;

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

type NpcSlice = {
  id: string;
  name: string;
  role: string;
  firearms: number;
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

function numStat(stats: unknown, key: string, fallback: number): number {
  if (!stats || typeof stats !== "object") return fallback;
  const v = (stats as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function pickAuthorityNpc(state: Record<string, unknown>): NpcSlice | null {
  const raw = Array.isArray(state.characters) ? state.characters : [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const role = String(o.role ?? "");
    if (!/officer|cop|police|deputy|sheriff|security|guard/i.test(role)) continue;
    return {
      id: String(o.id ?? "authority"),
      name: String(o.name ?? "the officer"),
      role,
      firearms: numStat(o.stats, "firearms", 50),
    };
  }
  return null;
}

function playerRestrained(state: Record<string, unknown> | null, scene: string | null): boolean {
  if (scene && /\b(cuff|cuffed|handcuff|restrain|restrained|pinned|face down|cannot move|held firm)\b/i.test(scene)) {
    return true;
  }
  if (!state?.player || typeof state.player !== "object") return false;
  const player = state.player as Record<string, unknown>;
  const conds = Array.isArray(player.conditions) ? player.conditions : [];
  for (const c of conds) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (o.kind === "restraint" || o.progress !== "resolved") {
    if (String(o.label ?? "").match(/cuff|restrain|pin/i)) return true;
    if (o.kind === "restraint") return true;
    if (Array.isArray(o.gates) && o.gates.includes("sprint")) return true;
    }
  }
  return false;
}

function resolveLethalConsequence(
  history: ClientTurn[],
  action: string,
  npc: NpcSlice | null
): ActionConsequenceResult | null {
  if (!isLethalRashAction(action)) return null;
  const name = npc?.name ?? "the officer";
  const id = npc?.id ?? "authority";
  return {
    kind: "lethal",
    fired: true,
    debug: { target: id, action },
    prompt_block: `[LETHAL CONSEQUENCE — server authoritative]
Player attempted lethal/rash violence against armed authority (${action}).
Target: ${name} (${id}). Grounded world — this is NOT survivable comedy.
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
  history: ClientTurn[],
  action: string,
  npc: NpcSlice | null,
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
  npc: NpcSlice | null
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

/**
 * Highest-priority server injection for rash violence, authority contact,
 * combat loops, and detention stasis.
 */
export function resolveActionConsequence(
  history: ClientTurn[]
): ActionConsequenceResult | null {
  const action = lastUserAction(history);
  if (!action) return null;

  const lastRaw = lastAssistantRaw(history);
  const state = lastRaw ? extractStateJson(lastRaw) : null;
  const s =
    state && typeof state === "object" ? (state as Record<string, unknown>) : null;
  const scene = lastRaw ? extractSceneBlock(lastRaw) : null;
  const npc = s ? pickAuthorityNpc(s) : null;
  const attackCount = countRecent(history, ATTACK_RE, 12);

  const lethal = resolveLethalConsequence(history, action, npc);
  if (lethal) return lethal;

  if (npc) {
    const authority = resolveAuthorityResponse(history, action, npc, attackCount);
    if (authority) return authority;
  }

  const combat = resolveCombatEscalation(history);
  if (combat?.fired) {
    return {
      kind: "combat",
      fired: true,
      debug: {
        attack_streak: combat.attack_streak,
        passive_last_scene: combat.passive_last_scene,
        target: combat.target_npc_id,
      },
      prompt_block: combat.prompt_block.replace(
        "NPC MUST win this turn:",
        "NPC MUST win this turn (NO extended stunlock — if player already cuffed, any new assault = lethal force or hard END):"
      ),
    };
  }

  const detention = resolveDetentionTimer(history, s, scene, npc);
  if (detention) return detention;

  return null;
}
