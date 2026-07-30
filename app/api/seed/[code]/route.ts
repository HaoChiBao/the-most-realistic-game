import { NextRequest, NextResponse } from "next/server";
import {
  assertSeedEngineCompatible,
  mapSeedLoadResponse,
} from "@/lib/seedLoad";
import { getSupabase } from "@/lib/supabase";
import { isValidCode } from "@/lib/seed";
import { ENGINE_VERSION } from "@/lib/systemPrompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ code: string }> }
) {
  const { code } = await ctx.params;

  if (!isValidCode(code)) {
    return NextResponse.json({ error: "Invalid seed code." }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Seed storage is not configured on the server." },
      { status: 503 }
    );
  }

  // load_world atomically bumps play_count and returns the row (incl. engine_ver).
  // RETURNS TABLE → array; some older installs may return a single object.
  const { data, error } = await supabase.rpc("load_world", { p_code: code });
  if (error) {
    return NextResponse.json(
      { error: "Could not load that world." },
      { status: 500 }
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return NextResponse.json({ error: "No world with that seed." }, {
      status: 404,
    });
  }

  const record = row as {
    code: string;
    setting?: string | null;
    opening: string;
    world_state: string;
    play_count?: number | null;
    engine_ver?: string | null;
  };

  const compat = assertSeedEngineCompatible(record.engine_ver, ENGINE_VERSION);
  if (!compat.ok) {
    // Withhold opening/world so clients cannot bypass the gate.
    return NextResponse.json(
      { error: compat.error, engineVer: record.engine_ver ?? null },
      { status: compat.status }
    );
  }

  return NextResponse.json(mapSeedLoadResponse(record));
}
