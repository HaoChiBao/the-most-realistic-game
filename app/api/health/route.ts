import { NextRequest } from "next/server";
import { resolveHealthForTurn } from "@/lib/healthTracker";
import type { ClientTurn } from "@/lib/gameMessages";
import { MAX_HISTORY_MESSAGES } from "@/lib/gameMessages";
import { getLlmConfig } from "@/lib/llm";
import {
  clientIp,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEALTH_RATE_LIMIT = 40;
const HEALTH_RATE_WINDOW_MS = 60_000;

/**
 * Lightweight post-turn HP classifier.
 * Body: { history, assistantContent }
 * Returns patched assistant content with authoritative player.stats.hp.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limited = rateLimit(
    `health:${ip}`,
    HEALTH_RATE_LIMIT,
    HEALTH_RATE_WINDOW_MS
  );
  if (!limited.ok) {
    return new Response("Health tracker busy. Try again shortly.", {
      status: 429,
      headers: rateLimitHeaders(limited),
    });
  }

  if (!getLlmConfig()) {
    // Heuristic path still works without keys, but warn via header.
  }

  let body: {
    history?: ClientTurn[];
    assistantContent?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(
      (t): t is ClientTurn =>
        !!t &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string"
    )
    .slice(-MAX_HISTORY_MESSAGES);

  const assistantContent =
    typeof body.assistantContent === "string" ? body.assistantContent : "";
  if (!assistantContent) {
    return new Response("Missing assistantContent", { status: 400 });
  }

  try {
    const { content, result } = await resolveHealthForTurn({
      history,
      assistantContent,
    });
    return Response.json(
      { content, result },
      { headers: rateLimitHeaders(limited) }
    );
  } catch (err) {
    return new Response(`Health tracker failed. ${String(err)}`, {
      status: 500,
      headers: rateLimitHeaders(limited),
    });
  }
}
