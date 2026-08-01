/**
 * Hydration contract gate (Phase 1.4).
 * After Phase B merge, assert the world is playable enough to mark ready.
 */

import type { WorldType } from "@/lib/worldSpec";
import { ensureBootstrapFields, minimalBootstrapState } from "@/lib/stateMerge";

export type HydrationContractResult = {
  ok: boolean;
  failures: string[];
  state: Record<string, unknown>;
};

export type HydrationContractOptions = {
  lawCount?: number;
  worldType?: WorldType;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function playerSheetComplete(player: unknown): boolean {
  if (!isRecord(player)) return false;
  if (!isRecord(player.body) || !isRecord(player.stats)) return false;
  const bodyKeys = ["head", "torso", "left_arm", "right_arm", "left_leg", "right_leg"];
  for (const k of bodyKeys) {
    if (player.body[k] == null) return false;
  }
  const statKeys = ["hp", "stamina", "combat", "awareness"];
  for (const k of statKeys) {
    if (typeof player.stats[k] !== "number") return false;
  }
  return true;
}

function characterPersonaReady(c: unknown): boolean {
  if (!isRecord(c) || c.id == null) return false;
  const training = c.training != null && String(c.training).trim() !== "";
  const disposition =
    c.disposition != null && String(c.disposition).trim() !== "";
  const violence = c.violence != null && String(c.violence).trim() !== "";
  return training && disposition && violence;
}

/**
 * Assert post-hydrate STATE meets the playable contract.
 * On soft failure, still returns a bootstrap-patched state for continued play.
 */
export function assertHydrationContract(
  state: Record<string, unknown> | null | undefined,
  opts: HydrationContractOptions = {}
): HydrationContractResult {
  const failures: string[] = [];
  let next = ensureBootstrapFields(
    state && isRecord(state) ? { ...state } : minimalBootstrapState()
  );

  const lawTarget = Math.max(2, Math.min(4, opts.lawCount ?? 2));
  const laws = Array.isArray(next.laws) ? next.laws : [];
  if (laws.length < lawTarget) {
    failures.push(`laws[] length ${laws.length} < required ${lawTarget}`);
  }

  const locations = Array.isArray(next.locations) ? next.locations : [];
  const hasExit = locations.some(
    (loc) =>
      isRecord(loc) &&
      Array.isArray(loc.exits) &&
      loc.exits.length > 0
  );
  if (!hasExit) {
    failures.push("need ≥1 location with ≥1 exit");
  }

  if (!playerSheetComplete(next.player)) {
    failures.push("player sheet incomplete (body + stats)");
    next = ensureBootstrapFields(next);
  }

  const characters = Array.isArray(next.characters) ? next.characters : [];
  const readyChars = characters.filter(characterPersonaReady);
  if (readyChars.length < 1) {
    failures.push(
      "need 1–3 characters with training/disposition/violence persona fields"
    );
  }

  if (!isRecord(next.starting_plot)) {
    failures.push("starting_plot object missing");
    next.starting_plot = { id: "bootstrap", phase: "setup", hook: "" };
  }

  if (opts.worldType) {
    const wt = String(next.world_type ?? "");
    if (wt && wt !== opts.worldType) {
      failures.push(
        `world_type "${wt}" does not match dial decode "${opts.worldType}"`
      );
      next.world_type = opts.worldType;
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    state: next,
  };
}
