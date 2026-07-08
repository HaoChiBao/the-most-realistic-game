import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { MODEL_LABEL } from "@/lib/model";
import { ENGINE_VERSION } from "@/lib/systemPrompt";
import {
  composeRaw,
  deriveSetting,
  makeSeedCode,
  splitSceneWorld,
} from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { raw?: string; opening?: string; world?: string };

export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Seed storage is not configured on the server." },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  // Accept either a raw two-layer message or pre-split opening + world.
  let opening = (body.opening ?? "").trim();
  let world = (body.world ?? "").trim();
  if ((!opening || !world) && body.raw) {
    const split = splitSceneWorld(String(body.raw));
    opening = opening || split.scene;
    world = world || split.world;
  }

  if (!opening || !world) {
    return NextResponse.json(
      { error: "This world is not ready to share yet." },
      { status: 400 }
    );
  }

  // Guard against runaway payloads.
  opening = opening.slice(0, 2000);
  world = world.slice(0, 20000);
  const setting = deriveSetting(opening);

  // Insert with a fresh numeric code, retrying on the rare collision.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeSeedCode();
    const { error } = await supabase.rpc("create_world", {
      p_code: code,
      p_setting: setting,
      p_opening: opening,
      p_world_state: world,
      p_model: MODEL_LABEL,
      p_engine_ver: ENGINE_VERSION,
    });

    if (!error) {
      return NextResponse.json({ code, setting });
    }
    // 23505 = unique_violation: code already taken, try another.
    if (error.code !== "23505") {
      return NextResponse.json(
        { error: "Could not save this world. Try again." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { error: "Could not allocate a seed code. Try again." },
    { status: 500 }
  );
}
