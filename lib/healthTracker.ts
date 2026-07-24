/**
 * Dedicated lightweight health tracker.
 *
 * Flow: detect possible harm → small LLM classifies severity → TypeScript
 * calculates exact HP loss and patches player.stats.hp / body / alive.
 * The narrative model does not own HP numbers on harm turns.
 */

import type { ClientTurn } from "@/lib/gameMessages";
import { getLlmConfig } from "@/lib/llm";
import { extractSceneBlock, extractStateJson } from "@/lib/stateParse";
import { rewriteWorldState } from "@/lib/stateMerge";

export type HarmSeverity =
  | "none"
  | "graze"
  | "light"
  | "moderate"
  | "heavy"
  | "critical"
  | "lethal";

export type BodyPart =
  | "head"
  | "torso"
  | "left_arm"
  | "right_arm"
  | "left_leg"
  | "right_leg";

export type InjuryKind =
  | "ok"
  | "bruised"
  | "cut"
  | "broken"
  | "shot"
  | "missing";

export type HarmAssessment = {
  harmed: boolean;
  severity: HarmSeverity;
  body_part: BodyPart | null;
  injury: InjuryKind;
  cause: string;
  unconscious: boolean;
  confidence: number;
};

export type DamageResult = {
  assessed: boolean;
  skipped: boolean;
  skip_reason?: string;
  prior_hp: number;
  damage: number;
  new_hp: number;
  died: boolean;
  unconscious: boolean;
  severity: HarmSeverity;
  body_part: BodyPart | null;
  injury: InjuryKind;
  cause: string;
  assessment: HarmAssessment | null;
  /** Prompt block for next-turn narrative consistency (optional inject). */
  prompt_block: string | null;
};

const ATTACK_RE =
  /\b(tackle|tackling|attack|attacking|punch|punches|punching|box|boxing|hit|hitting|kick|kicking|stab|shoot|shooting|fight|fighting|assault|throw|throwing|swing|bash|beat|slug|smash|strike|wrestle|grapple|choke|headbutt|burn|ignite)\b/i;

const HARM_SCENE_RE =
  /\b(bleed|bleeding|blood|wound|wounded|bruise|bruised|broke|broken|fracture|shot|gunshot|stab(bed|s|bing)?|punch(ed|es|ing)?|kick(ed|s|ing)?|slam(med|s)?|crack(ed|s)?|gash|cut you|cuts you|strikes? you|hits you|hit you|hurts? you|hurt you|injur(e|ed|y)|unconscious|collapse[sd]?|knocked (out|down)|takedown|pins? you|slams? you|baton|bullet|blade)\b/i;

/** Base HP loss ranges by severity (inclusive). Midpoint used with light jitter. */
export const SEVERITY_DAMAGE: Record<
  HarmSeverity,
  { min: number; max: number }
> = {
  none: { min: 0, max: 0 },
  graze: { min: 1, max: 5 },
  light: { min: 6, max: 15 },
  moderate: { min: 16, max: 30 },
  heavy: { min: 31, max: 50 },
  critical: { min: 51, max: 80 },
  lethal: { min: 85, max: 100 },
};

const BODY_DAMAGE_MULT: Record<BodyPart, number> = {
  head: 1.25,
  torso: 1.0,
  left_arm: 0.7,
  right_arm: 0.7,
  left_leg: 0.75,
  right_leg: 0.75,
};

const INJURY_RANK: Record<InjuryKind, number> = {
  ok: 0,
  bruised: 1,
  cut: 2,
  broken: 3,
  shot: 4,
  missing: 5,
};

const SEVERITY_DEFAULT_INJURY: Record<HarmSeverity, InjuryKind> = {
  none: "ok",
  graze: "bruised",
  light: "bruised",
  moderate: "cut",
  heavy: "broken",
  critical: "shot",
  lethal: "shot",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function numStat(stats: unknown, key: string, fallback: number): number {
  if (!isRecord(stats)) return fallback;
  const v = stats[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function lastUserAction(history: ClientTurn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return history[i].content;
  }
  return "";
}

function getPlayerSlice(state: Record<string, unknown> | null): {
  hp: number;
  combat: number;
  composure: number;
  body: Record<string, string>;
  alive: boolean;
  conscious: boolean;
} {
  const player =
    state && isRecord(state.player) ? state.player : ({} as Record<string, unknown>);
  const stats = isRecord(player.stats) ? player.stats : {};
  const body = isRecord(player.body)
    ? (player.body as Record<string, string>)
    : {
        head: "ok",
        torso: "ok",
        left_arm: "ok",
        right_arm: "ok",
        left_leg: "ok",
        right_leg: "ok",
      };
  return {
    hp: clamp(Math.round(numStat(stats, "hp", 100)), 0, 100),
    combat: numStat(stats, "combat", 20),
    composure: numStat(stats, "composure", 50),
    body,
    alive: player.alive !== false,
    conscious: player.conscious !== false,
  };
}

function pickHostileCombat(state: Record<string, unknown> | null): number {
  if (!state || !Array.isArray(state.characters)) return 35;
  let best = 0;
  for (const c of state.characters) {
    if (!isRecord(c) || c.id === "player") continue;
    const role = String(c.role ?? "");
    const disposition = String(c.disposition ?? "");
    const posture = String(c.combat_posture ?? "");
    const hostile =
      disposition === "hostile" ||
      /aggressive|restraining|defensive|alert/.test(posture) ||
      /guard|officer|cop|security|bouncer/i.test(role);
    if (!hostile) continue;
    best = Math.max(best, numStat(c.stats, "combat", 40));
  }
  return best || 35;
}

/** Deterministic-ish jitter from scene text so same scene → same damage. */
function sceneJitter(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

export function shouldAssessHealth(
  history: ClientTurn[],
  scene: string | null
): { assess: boolean; reason: string } {
  const action = lastUserAction(history);
  if (!action) return { assess: false, reason: "no_action" };

  if (ATTACK_RE.test(action)) {
    return { assess: true, reason: "player_violence" };
  }
  if (scene && HARM_SCENE_RE.test(scene)) {
    return { assess: true, reason: "scene_harm" };
  }

  // Mid-fight: recent attacks even if this turn was non-attack (dodge/talk).
  let recentAttacks = 0;
  for (const t of history.slice(-8)) {
    if (t.role === "user" && ATTACK_RE.test(t.content)) recentAttacks++;
  }
  if (recentAttacks >= 2 && scene && scene.length > 20) {
    return { assess: true, reason: "active_altercation" };
  }

  return { assess: false, reason: "no_harm_signal" };
}

/**
 * Calculate HP damage from a classified assessment + combat context.
 * Pure function — safe to unit test without LLM.
 */
export function calculateDamage(
  assessment: HarmAssessment,
  opts: {
    playerCombat: number;
    npcCombat: number;
    sceneSeed: string;
  }
): number {
  if (!assessment.harmed || assessment.severity === "none") return 0;

  const range = SEVERITY_DAMAGE[assessment.severity];
  const jitter = sceneJitter(opts.sceneSeed + assessment.cause);
  let dmg = range.min + jitter * (range.max - range.min);

  if (assessment.body_part) {
    dmg *= BODY_DAMAGE_MULT[assessment.body_part];
  }

  // Skill gap: outmatched → more damage; skilled → slight mitigation (cap ±25%).
  const gap = opts.npcCombat - opts.playerCombat;
  const skillMod = clamp(1 + gap / 200, 0.75, 1.25);
  dmg *= skillMod;

  if (assessment.severity === "lethal") {
    dmg = Math.max(dmg, 85);
  }

  return clamp(Math.round(dmg), 0, 100);
}

export function applyHealthDamage(
  state: Record<string, unknown>,
  assessment: HarmAssessment,
  damage: number
): {
  state: Record<string, unknown>;
  prior_hp: number;
  new_hp: number;
  died: boolean;
  unconscious: boolean;
} {
  const player = getPlayerSlice(state);
  const prior_hp = player.hp;
  const new_hp = clamp(prior_hp - damage, 0, 100);
  const died = new_hp <= 0;
  const unconscious =
    died ||
    assessment.unconscious ||
    (assessment.body_part === "head" &&
      (assessment.severity === "heavy" ||
        assessment.severity === "critical" ||
        assessment.severity === "lethal"));

  const nextBody = { ...player.body };
  if (
    assessment.harmed &&
    assessment.body_part &&
    assessment.injury !== "ok"
  ) {
    const cur = (nextBody[assessment.body_part] ?? "ok") as InjuryKind;
    const next = assessment.injury;
    if ((INJURY_RANK[next] ?? 0) >= (INJURY_RANK[cur] ?? 0)) {
      nextBody[assessment.body_part] = next;
    }
  }

  const painBump =
    assessment.severity === "none"
      ? 0
      : assessment.severity === "graze"
        ? 5
        : assessment.severity === "light"
          ? 15
          : assessment.severity === "moderate"
            ? 30
            : assessment.severity === "heavy"
              ? 50
              : 70;

  const basePlayer = isRecord(state.player) ? state.player : {};
  const baseStats = isRecord(basePlayer.stats) ? basePlayer.stats : {};
  const priorPain = numStat(baseStats, "pain", 0);

  const nextPlayer: Record<string, unknown> = {
    ...basePlayer,
    body: nextBody,
    stats: {
      ...baseStats,
      hp: new_hp,
      pain: clamp(Math.max(priorPain, painBump), 0, 100),
    },
    conscious: died ? false : unconscious ? false : basePlayer.conscious !== false,
    alive: died ? false : basePlayer.alive !== false,
  };

  // Attach a short trauma condition on moderate+ hits.
  if (
    assessment.harmed &&
    assessment.severity !== "none" &&
    assessment.severity !== "graze"
  ) {
    const conds = Array.isArray(basePlayer.conditions)
      ? [...basePlayer.conditions]
      : [];
    const id = `trauma_${assessment.body_part ?? "body"}_${assessment.severity}`;
    const existing = conds.findIndex(
      (c) => isRecord(c) && String(c.id) === id
    );
    const stage =
      assessment.severity === "light"
        ? "mild"
        : assessment.severity === "moderate"
          ? "moderate"
          : assessment.severity === "heavy"
            ? "severe"
            : "critical";
    const record = {
      id,
      kind: "trauma",
      label: assessment.cause.slice(0, 48) || `${assessment.severity} trauma`,
      subject: "player",
      severity: clamp(damage, 1, 100),
      stage,
      progress: died ? "terminal" : "worsening",
      turns_active: 1,
      source: assessment.cause,
      gates:
        assessment.body_part === "left_leg" ||
        assessment.body_part === "right_leg"
          ? ["sprint"]
          : assessment.body_part === "head"
            ? ["think_clearly"]
            : [],
      death_risk: assessment.severity === "critical" || assessment.severity === "lethal",
    };
    if (existing >= 0) conds[existing] = record;
    else conds.push(record);
    nextPlayer.conditions = conds;
  }

  return {
    state: { ...state, player: nextPlayer },
    prior_hp,
    new_hp,
    died,
    unconscious,
  };
}

function parseAssessmentJson(raw: string): HarmAssessment | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(trimmed.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const severityRaw = String(o.severity ?? "none").toLowerCase();
    const severity = (
      severityRaw in SEVERITY_DAMAGE ? severityRaw : "none"
    ) as HarmSeverity;
    const partRaw = o.body_part == null ? null : String(o.body_part);
    const body_part =
      partRaw && partRaw in BODY_DAMAGE_MULT
        ? (partRaw as BodyPart)
        : null;
    let injury = String(o.injury ?? SEVERITY_DEFAULT_INJURY[severity]) as InjuryKind;
    if (!(injury in INJURY_RANK)) {
      injury = SEVERITY_DEFAULT_INJURY[severity];
    }
    const harmed =
      o.harmed === true ||
      (severity !== "none" && o.harmed !== false);
    return {
      harmed,
      severity: harmed ? severity : "none",
      body_part,
      injury: harmed ? injury : "ok",
      cause: String(o.cause ?? "").slice(0, 120),
      unconscious: o.unconscious === true,
      confidence: clamp(Number(o.confidence ?? 0.5), 0, 1),
    };
  } catch {
    return null;
  }
}

/** Fallback when the LLM is unavailable or returns garbage. */
export function heuristicAssessment(
  action: string,
  scene: string
): HarmAssessment {
  const text = `${action}\n${scene}`;
  const shot = /\b(shot|gunshot|bullet|fires?)\b/i.test(text);
  const stab = /\b(stab|blade|knife|slash)\b/i.test(text);
  const knock = /\b(knocked (out|down)|unconscious|takedown|slams? you)\b/i.test(
    text
  );
  const hitYou = HARM_SCENE_RE.test(scene);
  const playerAttack = ATTACK_RE.test(action);

  if (!hitYou && !playerAttack) {
    return {
      harmed: false,
      severity: "none",
      body_part: null,
      injury: "ok",
      cause: "no clear injury",
      unconscious: false,
      confidence: 0.4,
    };
  }

  let severity: HarmSeverity = "light";
  if (shot) severity = /head|chest|torso|heart/i.test(text) ? "lethal" : "critical";
  else if (stab) severity = "heavy";
  else if (knock) severity = "moderate";
  else if (/\b(bruise|graze|scrape|glance)\b/i.test(text)) severity = "graze";
  else if (playerAttack && hitYou) severity = "moderate";

  let body_part: BodyPart = "torso";
  if (/\bhead|face|skull|jaw\b/i.test(text)) body_part = "head";
  else if (/\bleft arm|left hand\b/i.test(text)) body_part = "left_arm";
  else if (/\bright arm|right hand\b/i.test(text)) body_part = "right_arm";
  else if (/\bleft leg|left knee\b/i.test(text)) body_part = "left_leg";
  else if (/\bright leg|right knee\b/i.test(text)) body_part = "right_leg";

  return {
    harmed: true,
    severity,
    body_part,
    injury: SEVERITY_DEFAULT_INJURY[severity],
    cause: shot
      ? "gunshot wound"
      : stab
        ? "stab wound"
        : knock
          ? "combat takedown"
          : "altercation injury",
    unconscious: knock || severity === "lethal" || body_part === "head",
    confidence: 0.35,
  };
}

const HEALTH_SYSTEM_PROMPT = `You are a tiny injury classifier for a text adventure.
Read the player action and the narrated SCENE. Decide if the PLAYER took physical harm THIS turn.

Reply with ONLY compact JSON (no markdown, no prose):
{"harmed":boolean,"severity":"none|graze|light|moderate|heavy|critical|lethal","body_part":"head|torso|left_arm|right_arm|left_leg|right_leg"|null,"injury":"ok|bruised|cut|broken|shot|missing","cause":"short phrase","unconscious":boolean,"confidence":0-1}

Rules:
- harmed=false / severity=none if the player was not injured (miss, dodge, NPC hurt instead, talk-only, restraint without blunt trauma).
- graze: scrape, near-miss contact, light shove bruise
- light: single punch/kick, shallow cut, hard shove into wall
- moderate: solid beating, bad fall, deep cut, baton strike
- heavy: sustained beating, stab, bone break, serious blunt trauma
- critical: gunshot (non-instantly-fatal), severe multi-hit trauma
- lethal: center-mass / head gunshot, neck slash, obviously fatal blow
- Prefer under-calling over over-calling. One clear hit → one severity.
- body_part null only when harmed=false.
- injury should match severity (bruised/cut/broken/shot).`;

export function buildHealthUserPrompt(input: {
  action: string;
  scene: string;
  priorHp: number;
  playerCombat: number;
  npcCombat: number;
}): string {
  return `Prior player HP: ${input.priorHp}/100
Player combat skill: ${input.playerCombat}
Likely opponent combat: ${input.npcCombat}

PLAYER ACTION:
${input.action.slice(0, 200)}

SCENE (what just happened):
${input.scene.slice(0, 900)}

Classify player harm for THIS turn only.`;
}

function getHealthModel(mainModel: string): string {
  const override = process.env.OPENAI_HEALTH_MODEL?.trim();
  if (override) return override;
  // Prefer a cheap/fast classifier on OpenAI; reuse main model on NIM.
  if (mainModel.startsWith("gpt-")) return "gpt-4.1-nano";
  return mainModel;
}

export async function classifyHarmWithLlm(input: {
  action: string;
  scene: string;
  priorHp: number;
  playerCombat: number;
  npcCombat: number;
}): Promise<HarmAssessment> {
  const llm = getLlmConfig();
  if (!llm) return heuristicAssessment(input.action, input.scene);

  const model = getHealthModel(llm.model);
  try {
    const res = await fetch(`${llm.url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: HEALTH_SYSTEM_PROMPT },
          { role: "user", content: buildHealthUserPrompt(input) },
        ],
        temperature: 0.2,
        max_tokens: 120,
        ...llm.extraBody,
      }),
    });
    if (!res.ok) return heuristicAssessment(input.action, input.scene);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json?.choices?.[0]?.message?.content ?? "";
    return (
      parseAssessmentJson(content) ??
      heuristicAssessment(input.action, input.scene)
    );
  } catch {
    return heuristicAssessment(input.action, input.scene);
  }
}

function healthPromptBlock(result: DamageResult): string | null {
  if (!result.assessed || result.skipped) return null;
  if (result.damage <= 0 && !result.died) return null;
  const lines = [
    `[HEALTH — server authoritative]`,
    `Player HP: ${result.prior_hp} → ${result.new_hp} (damage ${result.damage}, severity=${result.severity}).`,
    result.cause ? `Cause: ${result.cause}.` : null,
    result.body_part
      ? `Body: ${result.body_part}=${result.injury}.`
      : null,
    result.died
      ? `DEAD: alive=false, conscious=false. Hard end with <ENDLABEL>DEAD</ENDLABEL><END> if not already ended.`
      : result.unconscious
        ? `Unconscious: conscious=false. Narrate collapse; player cannot act freely.`
        : `Keep player.stats.hp exactly ${result.new_hp} in STATE. Do not heal mid-fight.`,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Run the dedicated health pass against a finished assistant turn.
 * Returns patched assistant content + damage metadata.
 */
export async function resolveHealthForTurn(input: {
  history: ClientTurn[];
  assistantContent: string;
}): Promise<{
  content: string;
  result: DamageResult;
}> {
  const scene =
    extractSceneBlock(input.assistantContent) ??
    input.assistantContent.slice(0, 900);
  const gate = shouldAssessHealth(input.history, scene);
  let priorState: Record<string, unknown> | null = null;
  const fromAssistant = extractStateJson(input.assistantContent);
  if (fromAssistant && typeof fromAssistant === "object") {
    priorState = fromAssistant as Record<string, unknown>;
  } else {
    for (let i = input.history.length - 1; i >= 0; i--) {
      if (input.history[i].role !== "assistant") continue;
      const s = extractStateJson(input.history[i].content);
      if (s && typeof s === "object") {
        priorState = s as Record<string, unknown>;
        break;
      }
    }
  }

  const player = getPlayerSlice(priorState);
  const empty: DamageResult = {
    assessed: false,
    skipped: true,
    skip_reason: gate.reason,
    prior_hp: player.hp,
    damage: 0,
    new_hp: player.hp,
    died: !player.alive || player.hp <= 0,
    unconscious: !player.conscious,
    severity: "none",
    body_part: null,
    injury: "ok",
    cause: "",
    assessment: null,
    prompt_block: null,
  };

  if (!gate.assess) {
    return { content: input.assistantContent, result: empty };
  }

  if (!priorState) {
    return {
      content: input.assistantContent,
      result: { ...empty, skip_reason: "no_state" },
    };
  }

  if (!player.alive || player.hp <= 0) {
    return {
      content: input.assistantContent,
      result: { ...empty, skip_reason: "already_dead", died: true },
    };
  }

  const action = lastUserAction(input.history);
  const npcCombat = pickHostileCombat(priorState);
  const assessment = await classifyHarmWithLlm({
    action,
    scene,
    priorHp: player.hp,
    playerCombat: player.combat,
    npcCombat,
  });

  const damage = calculateDamage(assessment, {
    playerCombat: player.combat,
    npcCombat,
    sceneSeed: scene,
  });

  const applied = applyHealthDamage(priorState, assessment, damage);
  const patched = rewriteWorldState(input.assistantContent, applied.state);

  // Force hard END markers into content when HP hits 0.
  let content = patched;
  if (applied.died && !/<\s*END\s*>/i.test(content)) {
    content = content.replace(
      /\s*$/,
      "\n<ENDLABEL>DEAD</ENDLABEL><END>"
    );
  }

  const result: DamageResult = {
    assessed: true,
    skipped: false,
    prior_hp: applied.prior_hp,
    damage,
    new_hp: applied.new_hp,
    died: applied.died,
    unconscious: applied.unconscious,
    severity: assessment.severity,
    body_part: assessment.body_part,
    injury: assessment.injury,
    cause: assessment.cause,
    assessment,
    prompt_block: null,
  };
  result.prompt_block = healthPromptBlock(result);

  return { content, result };
}
