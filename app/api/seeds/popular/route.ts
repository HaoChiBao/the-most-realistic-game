import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ worlds: [] });
  }

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "24");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), 100)
    : 24;

  // popular_worlds deliberately omits the hidden world_state.
  const { data, error } = await supabase.rpc("popular_worlds", {
    p_limit: limit,
  });
  if (error) {
    return NextResponse.json({ worlds: [] });
  }

  return NextResponse.json({ worlds: data ?? [] });
}
