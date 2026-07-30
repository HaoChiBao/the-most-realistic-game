/**
 * Shared-world load helpers — engine_ver compatibility (Phase 0.4).
 * Pure functions so CI can cover refuse/migrate gates without Supabase.
 */

export type SeedEngineCheck =
  | { ok: true; engineVer: string }
  | { ok: false; status: 409; error: string };

/**
 * Shared worlds are exact turn-1 snapshots for a specific engine.
 * Exact string match with ENGINE_VERSION; missing/empty counts as mismatch.
 */
export function assertSeedEngineCompatible(
  stored: string | null | undefined,
  current: string
): SeedEngineCheck {
  const engineVer = typeof stored === "string" ? stored.trim() : "";
  if (!engineVer) {
    return {
      ok: false,
      status: 409,
      error:
        "This world has no engine version and cannot be loaded safely. Start a new world.",
    };
  }
  if (engineVer !== current) {
    return {
      ok: false,
      status: 409,
      error: `This world was built for engine ${engineVer}; this server is ${current}. Start a new world (or re-share after regenerating).`,
    };
  }
  return { ok: true, engineVer };
}

/** Shape returned to the client after a successful load. */
export function mapSeedLoadResponse(data: {
  code: string;
  setting?: string | null;
  opening: string;
  world_state: string;
  play_count?: number | null;
  engine_ver?: string | null;
}): {
  code: string;
  setting: string | null;
  opening: string;
  world: string;
  playCount: number;
  engineVer: string | null;
} {
  return {
    code: data.code,
    setting: data.setting ?? null,
    opening: data.opening,
    world: data.world_state,
    playCount: typeof data.play_count === "number" ? data.play_count : 0,
    engineVer: data.engine_ver ?? null,
  };
}
