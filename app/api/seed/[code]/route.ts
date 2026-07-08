import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { isValidCode } from "@/lib/seed";

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

  // load_world atomically bumps play_count and returns the row.
  const { data, error } = await supabase.rpc("load_world", { p_code: code });
  if (error) {
    return NextResponse.json(
      { error: "Could not load that world." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "No world with that seed." }, {
      status: 404,
    });
  }

  return NextResponse.json({
    code: data.code,
    setting: data.setting,
    opening: data.opening,
    world: data.world_state,
    playCount: data.play_count,
  });
}
