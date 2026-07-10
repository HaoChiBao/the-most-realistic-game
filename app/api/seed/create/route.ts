import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getModelLabel } from "@/lib/model";
import { ENGINE_VERSION } from "@/lib/systemPrompt";
import {
  deriveSetting,
  makeSeedCode,
  splitSceneWorld,
} from "@/lib/seed";
import {
  clientIp,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEED_CREATE_LIMIT = 10;
const SEED_CREATE_WINDOW_MS = 60_000;

type Body = { raw?: string; opening?: string; world?: string; code?: string };

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limited = rateLimit(
    `seed-create:${ip}`,
    SEED_CREATE_LIMIT,
    SEED_CREATE_WINDOW_MS
  );
  if (!limited.ok) {
    const retryAfter = Math.max(
      1,
      Math.ceil((limited.resetAt - Date.now()) / 1000)
    );
    return NextResponse.json(
      { error: "Too many worlds saved. Try again shortly." },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders(limited),
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Seed storage is not configured on the server." },
      { status: 503, headers: rateLimitHeaders(limited) }
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
      { status: 400, headers: rateLimitHeaders(limited) }
    );
  }

  // Guard against runaway payloads.
  opening = opening.slice(0, 2000);
  world = world.slice(0, 20000);
  const setting = deriveSetting(opening);

  // Prefer client-allocated dial code (digits already biased generation).
  // Fall back to random codes on collision / missing preferred code.
  const preferred =
    typeof body.code === "string" && /^\d{10,14}$/.test(body.code.trim())
      ? body.code.trim()
      : null;

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = attempt === 0 && preferred ? preferred : makeSeedCode();
    const { error } = await supabase.rpc("create_world", {
      p_code: code,
      p_setting: setting,
      p_opening: opening,
      p_world_state: world,
      p_model: getModelLabel(),
      p_engine_ver: ENGINE_VERSION,
    });

    if (!error) {
      return NextResponse.json(
        { code, setting },
        { headers: rateLimitHeaders(limited) }
      );
    }
    // 23505 = unique_violation: code already taken, try another.
    if (error.code !== "23505") {
      return NextResponse.json(
        { error: "Could not save this world. Try again." },
        { status: 500, headers: rateLimitHeaders(limited) }
      );
    }
  }

  return NextResponse.json(
    { error: "Could not allocate a seed code. Try again." },
    { status: 500, headers: rateLimitHeaders(limited) }
  );
}
