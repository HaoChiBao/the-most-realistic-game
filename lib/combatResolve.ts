/**
 * Server-authored combat outcome envelope.
 * Runtime picks a structured outcome; the model narrates inside the box.
 */

import { seededRoll } from "@/lib/randomness";
import type { SelectableNpc } from "@/lib/npcSelect";
import { isAuthorityNpc } from "@/lib/npcSelect";

export type CombatOutcome =
  | "npc_restrains"
  | "npc_ko"
  | "npc_lethal"
  | "player_wounds_npc"
  | "player_flees"
  | "stalemate_costly";

export type CombatActionTag =
  | "attack"
  | "flee"
  | "lethal_rash"
  | "taunt"
  | "other";

export type CombatResolveInput = {
  action: string;
  tags?: CombatActionTag[];
  playerCombat: number;
  /** Approximate remaining durability 0–100; default 70. */
  playerHp?: number;
  playerRestrained?: boolean;
  npc: Pick<
    SelectableNpc,
    "id" | "name" | "role" | "combat" | "firearms" | "training" | "archetype" | "authority_level"
  >;
  isAuthority?: boolean;
  heatLevel?: number;
  attackStreak: number;
  seedCode?: string | null;
  turn?: number;
  weapons?: string[];
};

export type CombatResolveResult = {
  outcome: CombatOutcome;
  roll: number;
  allowed_scene_verbs: string[];
  forbidden_stalls: string[];
  required_patches: string[];
  end_label: string | null;
  prompt_block: string;
  debug: Record<string, unknown>;
};

const ATTACK_RE =
  /\b(tackle|tackling|attack|attacking|punch|punches|punching|box|boxing|hit|hitting|kick|kicking|stab|shoot|fight|fighting|assault|throw|throwing|swing|bash|beat|slug|smash|strike|wrestle|grapple|choke|headbutt)\b/i;

const FLEE_RE =
  /\b(flee|run\s+away|run\s+for|sprint\s+away|bolt|escape|get\s+away|leg\s*it|retreat|back\s+off|break\s+away)\b/i;

const TAUNT_RE =
  /\b(taunt|pussy|coward|bitch|weak|loser|scared|fight back|come at me|do something)\b/i;

const LETHAL_RASH_RE =
  /\b(shoot|gun down|kill)\b|\b(reach|grab|take|pull|snatch|wrestle|tackle)\b.{0,40}\b(gun|weapon|holster|firearm|pistol|sidearm)\b/i;

const FORBIDDEN_STALLS = [
  "ready to respond",
  "looks ready",
  "hesitant",
  "cautious",
  "doesn't rush",
  "prepares to push back",
  "blocks some",
  "raises hands defensively",
  "still wary",
  "tension hangs",
  "standoff continues",
];

function trainingRank(training: string): number {
  switch (String(training).toLowerCase()) {
    case "elite":
      return 3;
    case "professional":
      return 2;
    case "basic":
      return 1;
    case "none":
    case "untrained":
      return 0;
    default:
      return 1;
  }
}

export function tagCombatAction(action: string): CombatActionTag[] {
  const tags: CombatActionTag[] = [];
  if (LETHAL_RASH_RE.test(action)) tags.push("lethal_rash");
  if (FLEE_RE.test(action)) tags.push("flee");
  if (ATTACK_RE.test(action)) tags.push("attack");
  if (TAUNT_RE.test(action)) tags.push("taunt");
  if (tags.length === 0) tags.push("other");
  return tags;
}

function outcomeCatalog(outcome: CombatOutcome): {
  verbs: string[];
  patches: string[];
  end_label: string | null;
} {
  switch (outcome) {
    case "npc_restrains":
      return {
        verbs: ["cuff", "pin", "twist down", "knee in back", "lock arms"],
        patches: [
          "player.conditions += restraint (cuffed/pinned)",
          "characters[target].combat_posture = restraining_player",
          "heat.level += 30–50; heat.witnesses = true; heat.response = backup_en_route if authority",
          "player body: bruises / strained wrist; combat/mobility reduced",
        ],
        end_label: null,
      };
    case "npc_ko":
      return {
        verbs: ["drop", "knock out", "slam", "choke out", "cold-cock"],
        patches: [
          "player.conscious = false (or near-blackout)",
          "player body: head/torso trauma; hp low",
          "characters[target].combat_posture = aggressive or restraining_player",
          "heat.level rises; memory of the fight on NPC",
        ],
        end_label: null,
      };
    case "npc_lethal":
      return {
        verbs: ["draw", "fire", "shoot", "drop with force"],
        patches: [
          "player: torso/head trauma, hp near 0, conscious false, alive false if center mass",
          "heat.level max; consequences flag lethal_assault_on_officer / lethal_force",
          "characters[target].memory records the shooting",
        ],
        end_label: "SHOT BY POLICE",
      };
    case "player_wounds_npc":
      return {
        verbs: ["land a hit", "cut", "bruise", "knock back", "wound"],
        patches: [
          "characters[target] body/stats damaged; combat_posture defensive or aggressive",
          "NPC memory of being hurt; disposition worsens",
          "player may take light cost (fatigue/bruise) but stays up",
          "heat rises if public / authority involved",
        ],
        end_label: null,
      };
    case "player_flees":
      return {
        verbs: ["break away", "sprint", "bolt", "slip free", "put distance"],
        patches: [
          "player_location moves along a valid exit OR clear separation in scene",
          "characters[target].combat_posture = alert or calling_backup (not restraining)",
          "player may take light chase cost; NOT cuffed this turn",
          "heat.response may escalate if authority was engaged",
        ],
        end_label: null,
      };
    case "stalemate_costly":
      return {
        verbs: ["trade blows", "clash", "both hurt", "scramble", "grapple messily"],
        patches: [
          "BOTH sides take real injury/fatigue this turn (body + stats)",
          "fight still open — combat_posture aggressive/defensive, not passive",
          "heat rises; no clean win; NO 'ready to respond' stall",
        ],
        end_label: null,
      };
  }
}

/**
 * Weighted pick among outcomes using a seeded 0–99 roll.
 * Weights are relative; empty → stalemate_costly.
 */
export function pickWeightedOutcome(
  weights: Partial<Record<CombatOutcome, number>>,
  roll: number
): CombatOutcome {
  const entries = (Object.entries(weights) as [CombatOutcome, number][]).filter(
    ([, w]) => typeof w === "number" && w > 0
  );
  if (entries.length === 0) return "stalemate_costly";
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let cursor = (roll % 100) / 100 * total;
  for (const [outcome, w] of entries) {
    cursor -= w;
    if (cursor < 0) return outcome;
  }
  return entries[entries.length - 1]![0];
}

function buildWeights(input: CombatResolveInput, tags: CombatActionTag[]): Partial<Record<CombatOutcome, number>> {
  const npc = input.npc;
  const authority =
    input.isAuthority ??
    isAuthorityNpc({
      ...npc,
      location: "",
      disposition: "hostile",
      combat_posture: "aggressive",
    } as SelectableNpc);

  const playerCombat = Number.isFinite(input.playerCombat) ? input.playerCombat : 20;
  const npcCombat = Number.isFinite(npc.combat) ? npc.combat : 40;
  const delta = npcCombat - playerCombat;
  const rank = trainingRank(npc.training);
  const streak = Math.max(0, input.attackStreak | 0);
  const heat = typeof input.heatLevel === "number" ? input.heatLevel : 0;
  const restrained = !!input.playerRestrained;
  const armed =
    (typeof npc.firearms === "number" && npc.firearms >= 40) ||
    /\b(officer|cop|police|deputy|sheriff)\b/i.test(npc.role);

  // Flee escapes the win envelope — costly separation, not cuff/KO.
  if (tags.includes("flee") && !restrained) {
    return { player_flees: 100 };
  }

  // Gun grab / shoot / kill vs armed authority → lethal.
  if (tags.includes("lethal_rash") && authority && armed) {
    return { npc_lethal: 100 };
  }

  // Already cuffed and still assaulting → lethal or hard KO.
  if (restrained && (tags.includes("attack") || tags.includes("lethal_rash"))) {
    if (authority && armed) {
      return { npc_lethal: 85, npc_ko: 15 };
    }
    return { npc_ko: 70, npc_restrains: 30 };
  }

  const weights: Partial<Record<CombatOutcome, number>> = {};

  if (authority && rank >= 2) {
    // Untrained / outclassed vs professional authority → restrain/lethal.
    weights.npc_restrains = 55 + Math.min(25, Math.max(0, delta));
    weights.npc_ko = 15;
    weights.npc_lethal =
      streak >= 3 || heat >= 60 || tags.includes("lethal_rash")
        ? 25 + Math.min(20, streak * 5)
        : streak >= 2
          ? 12
          : 4;
    weights.stalemate_costly = playerCombat >= npcCombat - 5 ? 10 : 3;
    if (delta < -10) {
      weights.player_wounds_npc = 8;
    }
  } else if (rank >= 2 || delta >= 15) {
    // Trained civilian / strong fighter dominates.
    weights.npc_restrains = 35;
    weights.npc_ko = 40;
    weights.stalemate_costly = 15;
    weights.player_wounds_npc = delta < 10 ? 10 : 5;
  } else if (delta <= -15) {
    // Player clearly stronger.
    weights.player_wounds_npc = 55;
    weights.stalemate_costly = 25;
    weights.npc_restrains = 10;
    weights.npc_ko = 10;
  } else {
    // Even scrap.
    weights.stalemate_costly = 40;
    weights.player_wounds_npc = 25;
    weights.npc_ko = 20;
    weights.npc_restrains = 15;
  }

  // Longer fight → less stalemate, more decisive NPC finish.
  if (streak >= 2) {
    weights.stalemate_costly = Math.max(0, (weights.stalemate_costly ?? 0) - 15);
    weights.npc_restrains = (weights.npc_restrains ?? 0) + 10;
    weights.npc_ko = (weights.npc_ko ?? 0) + 8;
  }

  return weights;
}

export function formatCombatOutcomeBlock(
  result: Omit<CombatResolveResult, "prompt_block">,
  input: CombatResolveInput
): string {
  const npc = input.npc;
  const verbs = result.allowed_scene_verbs.join(", ");
  const banned = result.forbidden_stalls.slice(0, 8).map((s) => `"${s}"`).join(", ");
  const patches = result.required_patches.map((p) => `- ${p}`).join("\n");
  const endLine = result.end_label
    ? `- Hard end: <ENDLABEL>${result.end_label}</ENDLABEL><END> when the shot/kill lands.`
    : "- Do NOT invent an unrelated hard END this turn.";

  return `[COMBAT OUTCOME — server authoritative]
Outcome (FIXED): ${result.outcome}
Target: ${npc.name} (${npc.id}) training=${npc.training} combat=${npc.combat} firearms=${npc.firearms}
Player combat=${input.playerCombat}; attack_streak=${input.attackStreak}; roll=${result.roll}
Action: ${input.action}

MANDATORY THIS TURN — narrate this outcome only:
Allowed SCENE verbs/beats: ${verbs}
Forbidden stalls: ${banned}
No plot nudges mid-fight (no new smells, mysteries, thread hooks) unless the player leaves the fight.

Required STATE patches:
${patches}
${endLine}

SCENE: blunt, immediate, 1-2 sentences. NO meta brackets. NO "you could try".`;
}

/**
 * Resolve a structured combat outcome for the current player action.
 */
export function resolveCombatOutcome(input: CombatResolveInput): CombatResolveResult {
  const tags = input.tags?.length ? input.tags : tagCombatAction(input.action);
  const turn = typeof input.turn === "number" && Number.isFinite(input.turn) ? input.turn : 1;
  const roll = seededRoll(input.seedCode, turn, `combat:${input.npc.id}:${input.attackStreak}`);
  const weights = buildWeights(input, tags);
  const outcome = pickWeightedOutcome(weights, roll);
  const catalog = outcomeCatalog(outcome);

  const partial = {
    outcome,
    roll,
    allowed_scene_verbs: catalog.verbs,
    forbidden_stalls: FORBIDDEN_STALLS,
    required_patches: catalog.patches,
    end_label: catalog.end_label,
    debug: {
      outcome,
      roll,
      weights,
      tags,
      target: input.npc.id,
      player_combat: input.playerCombat,
      npc_combat: input.npc.combat,
      attack_streak: input.attackStreak,
      training: input.npc.training,
    },
  };

  return {
    ...partial,
    prompt_block: formatCombatOutcomeBlock(partial, input),
  };
}
