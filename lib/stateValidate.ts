/**
 * Patch validation before bible commit (Phase 1.2).
 * Runtime rejects / repairs illegal STATE transitions.
 */

import { auditSceneKnowledge } from "@/lib/playerKnowledge";

export type ValidateSeverity = "reject" | "repair" | "warn";

export type ValidateIssue = {
  code: string;
  severity: ValidateSeverity;
  message: string;
};

export type ValidateResult = {
  ok: boolean;
  state: Record<string, unknown>;
  issues: ValidateIssue[];
  /** Hard-reject: keep previous bible. */
  rejected: boolean;
};

export type ValidateOptions = {
  /** Player turn → clock.turn must advance. Opening/hydrate may keep turn 1. */
  isPlayerTurn?: boolean;
  /** SCENE text for name↔registry warn. */
  scene?: string | null;
  /** Allow teleport / forced relocation (detention, combat drag). */
  forcedMove?: boolean;
};

const BODY_ENUM = new Set([
  "ok",
  "bruised",
  "cut",
  "bleeding",
  "broken",
  "burned",
  "bandaged",
  "missing",
  "numb",
  "swollen",
  "sprained",
  "fractured",
  "gunshot",
  "stabbed",
]);

const DEFAULT_PLAYER_BODY: Record<string, string> = {
  head: "ok",
  torso: "ok",
  left_arm: "ok",
  right_arm: "ok",
  left_leg: "ok",
  right_leg: "ok",
};

const DEFAULT_PLAYER_STATS: Record<string, number> = {
  hp: 100,
  stamina: 80,
  pain: 0,
  combat: 20,
  firearms: 15,
  awareness: 40,
  composure: 50,
  mobility: 100,
};

const CORE_STATS = Object.keys(DEFAULT_PLAYER_STATS);

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function locationIds(state: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const locs = Array.isArray(state.locations) ? state.locations : [];
  for (const loc of locs) {
    if (isRecord(loc) && loc.id != null) ids.add(String(loc.id));
  }
  return ids;
}

function exitsFrom(
  state: Record<string, unknown>,
  fromId: string
): Set<string> {
  const outs = new Set<string>();
  const locs = Array.isArray(state.locations) ? state.locations : [];
  for (const loc of locs) {
    if (!isRecord(loc) || String(loc.id) !== fromId) continue;
    const exits = Array.isArray(loc.exits) ? loc.exits : [];
    for (const e of exits) outs.add(String(e));
  }
  return outs;
}

function characterIds(state: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const chars = Array.isArray(state.characters) ? state.characters : [];
  for (const c of chars) {
    if (isRecord(c) && c.id != null) ids.add(String(c.id));
    if (isRecord(c) && c.name != null) ids.add(String(c.name).toLowerCase());
  }
  return ids;
}

/** Capitalized proper names / role titles that look like people in SCENE. */
export function extractScenePersonHints(scene: string | null | undefined): string[] {
  if (!scene) return [];
  const hints: string[] = [];
  const re =
    /\b((?:Officer|Detective|Deputy|Sheriff|Dr|Mr|Ms|Mrs)\s+[A-Z][a-z]+|[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scene)) !== null) {
    const name = m[1].trim();
    // Skip common non-person sentence starts.
    if (
      /^(You|The|A|An|Your|His|Her|Their|This|That|There|Then|When|While|After|Before|Suddenly)\b/.test(
        name
      )
    ) {
      continue;
    }
    hints.push(name);
  }
  return hints;
}

function repairBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...DEFAULT_PLAYER_BODY, ...body };
  for (const [k, v] of Object.entries(out)) {
    const s = String(v).toLowerCase();
    if (!BODY_ENUM.has(s) && !(k in DEFAULT_PLAYER_BODY && s === "ok")) {
      // Keep known-ish trauma words; unknown → ok
      if (!/bleed|broke|burn|bruise|cut|wound|fracture|sprain|shot|stab/.test(s)) {
        out[k] = "ok";
      }
    }
  }
  return out;
}

function repairStats(stats: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CORE_STATS) {
    const raw = stats[key];
    const n =
      typeof raw === "number" && Number.isFinite(raw)
        ? raw
        : (DEFAULT_PLAYER_STATS[key] ?? 0);
    out[key] = Math.max(0, Math.min(100, n));
  }
  return out;
}

/**
 * Validate a proposed next STATE against the previous bible.
 * Mutates a copy: repairs where possible; sets rejected on hard fails.
 */
export function validateStateTransition(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>,
  opts: ValidateOptions = {}
): ValidateResult {
  const issues: ValidateIssue[] = [];
  let state: Record<string, unknown> = { ...next };
  let rejected = false;

  const prevClock = isRecord(prev?.clock) ? prev!.clock : null;
  const nextClock = isRecord(state.clock) ? { ...state.clock } : { turn: 1 };
  const prevTurn = typeof prevClock?.turn === "number" ? prevClock.turn : 0;
  const nextTurn =
    typeof nextClock.turn === "number" && Number.isFinite(nextClock.turn)
      ? nextClock.turn
      : prevTurn || 1;

  // clock.turn must increase by ≥1 on player turns
  if (opts.isPlayerTurn && prev) {
    if (nextTurn < prevTurn + 1) {
      nextClock.turn = prevTurn + 1;
      state.clock = nextClock;
      issues.push({
        code: "clock_turn",
        severity: "repair",
        message: `clock.turn clamped from ${nextTurn} to ${prevTurn + 1}`,
      });
    }
  } else if (nextTurn < 1) {
    nextClock.turn = 1;
    state.clock = nextClock;
    issues.push({
      code: "clock_turn",
      severity: "repair",
      message: "clock.turn repaired to ≥1",
    });
  }

  // player_location must exist in locations[] (when locations are non-empty)
  const locIds = locationIds(state);
  const playerLoc =
    state.player_location != null ? String(state.player_location) : "";
  if (locIds.size > 0 && playerLoc && !locIds.has(playerLoc)) {
    issues.push({
      code: "unknown_location",
      severity: "reject",
      message: `player_location "${playerLoc}" not in locations[]`,
    });
    rejected = true;
  }

  // Movement only along exits unless forced
  if (
    prev &&
    !opts.forcedMove &&
    !rejected &&
    prev.player_location != null &&
    playerLoc &&
    String(prev.player_location) !== playerLoc
  ) {
    const from = String(prev.player_location);
    const allowed = exitsFrom(prev, from);
    // Also allow exits declared on the new state's from-node
    for (const e of exitsFrom(state, from)) allowed.add(e);
    if (allowed.size > 0 && !allowed.has(playerLoc) && !locIds.has(playerLoc)) {
      // already rejected above
    } else if (allowed.size > 0 && !allowed.has(playerLoc)) {
      issues.push({
        code: "illegal_move",
        severity: "reject",
        message: `move ${from} → ${playerLoc} not along exits`,
      });
      rejected = true;
    }
  }

  // No teleport alive: false → true without resurrection flag
  if (prev && isRecord(prev.player) && isRecord(state.player)) {
    const wasAlive = prev.player.alive !== false;
    const nowAlive = state.player.alive !== false;
    const resurrection =
      state.player.flags != null &&
      Array.isArray(state.player.flags) &&
      state.player.flags.some((f) => /resurrect/i.test(String(f)));
    if (!wasAlive && nowAlive && !resurrection) {
      issues.push({
        code: "alive_teleport",
        severity: "reject",
        message: "alive false→true without resurrection flag",
      });
      rejected = true;
    }
  }

  // Body part repair
  if (isRecord(state.player)) {
    const player = { ...state.player };
    if (isRecord(player.body)) {
      const before = JSON.stringify(player.body);
      player.body = repairBody(player.body);
      if (JSON.stringify(player.body) !== before) {
        issues.push({
          code: "body_enum",
          severity: "repair",
          message: "body part values repaired to allowed set",
        });
      }
    }
    if (isRecord(player.stats)) {
      const before = JSON.stringify(player.stats);
      player.stats = repairStats(player.stats);
      if (JSON.stringify(player.stats) !== before) {
        issues.push({
          code: "stats_clamp",
          severity: "repair",
          message: "stats keys clamped to core set 0–100",
        });
      }
    }

    // grounded ⇒ no magic abilities invented mid-run
    const worldType = String(state.world_type ?? prev?.world_type ?? "grounded");
    if (worldType === "grounded" && prev && isRecord(prev.player)) {
      const prevAb = Array.isArray(prev.player.abilities)
        ? prev.player.abilities.map(String)
        : [];
      const nextAb = Array.isArray(player.abilities)
        ? player.abilities.map(String)
        : [];
      const invented = nextAb.filter(
        (a) =>
          !prevAb.includes(a) &&
          /\b(magic|spell|fly|teleport|laser|superpower|invisib)/i.test(a)
      );
      if (invented.length > 0) {
        player.abilities = prevAb;
        issues.push({
          code: "grounded_ability",
          severity: "reject",
          message: `rejected grounded ability add: ${invented.join(", ")}`,
        });
        rejected = true;
      }
    }

    state.player = player;
  }

  // Named person in SCENE without characters[] — warn
  if (opts.scene) {
    const known = characterIds(state);
    const hints = extractScenePersonHints(opts.scene);
    const missing = hints.filter((h) => {
      const lower = h.toLowerCase();
      if (known.has(lower)) return false;
      // Allow first token match against role nouns already in registry names
      for (const id of known) {
        if (id.includes(lower.split(/\s+/)[0] ?? "")) return false;
      }
      return true;
    });
    if (missing.length > 0) {
      issues.push({
        code: "scene_name_unregistered",
        severity: "warn",
        message: `SCENE names without characters[] sheet: ${missing.join(", ")}`,
      });
    }

    // Premature name/role/backstory before player_knowledge earned — warn
    const chars = Array.isArray(state.characters) ? state.characters : [];
    for (const leak of auditSceneKnowledge(opts.scene, chars)) {
      issues.push({
        code: `knowledge_${leak.code}`,
        severity: "warn",
        message: `${leak.npcId}: ${leak.detail}`,
      });
    }
  }

  if (rejected && prev) {
    return {
      ok: false,
      rejected: true,
      state: { ...prev },
      issues,
    };
  }

  return {
    ok: issues.every((i) => i.severity !== "reject"),
    rejected: false,
    state,
    issues,
  };
}
