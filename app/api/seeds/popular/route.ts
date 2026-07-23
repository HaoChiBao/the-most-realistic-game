import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      {
        error: "Seed storage is not configured on the server.",
        worlds: [],
      },
      { status: 503 }
    );
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
    return NextResponse.json(
      { error: "Could not load shared worlds.", worlds: [] },
      { status: 500 }
    );
  }

  return NextResponse.json({ worlds: data ?? [] });
}
