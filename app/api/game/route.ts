import { NextRequest } from "next/server";
import { buildGameMessages, MAX_HISTORY_MESSAGES } from "@/lib/gameMessages";
import { getLlmConfig } from "@/lib/llm";
import { resolveActionConsequence } from "@/lib/actionConsequence";
import { resolveRollForHistory } from "@/lib/rollContext";
import {
  clientIp,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INPUT_CHARS = 140;
/** Soft per-IP cap so a public LLM key isn't drained by a single client. */
const GAME_RATE_LIMIT = 30;
const GAME_RATE_WINDOW_MS = 60_000;
/** Reject only abusive payloads — normal play trims to MAX_HISTORY_MESSAGES. */
const MAX_HISTORY_PAYLOAD = 200;

type ClientTurn = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limited = rateLimit(`game:${ip}`, GAME_RATE_LIMIT, GAME_RATE_WINDOW_MS);
  if (!limited.ok) {
    const retryAfter = Math.max(
      1,
      Math.ceil((limited.resetAt - Date.now()) / 1000)
    );
    return new Response(
      "TOO MANY ACTIONS. The world needs a moment. Try again shortly.",
      {
        status: 429,
        headers: {
          ...rateLimitHeaders(limited),
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  const llm = getLlmConfig();
  if (!llm) {
    return new Response(
      "SYSTEM FAILURE: OPENAI_API_KEY (or NIM_API_KEY) is not configured on the server.",
      { status: 500 }
    );
  }

  let body: { history?: ClientTurn[]; seedCode?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawHistory = Array.isArray(body.history) ? body.history : [];
  if (rawHistory.length > MAX_HISTORY_PAYLOAD) {
    return new Response("SESSION TOO LONG. Start a new world.", {
      status: 400,
      headers: rateLimitHeaders(limited),
    });
  }

  const cappedHistory = rawHistory.slice(-MAX_HISTORY_MESSAGES);

  const history: ClientTurn[] = cappedHistory
    .filter(
      (t): t is ClientTurn =>
        t &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string"
    )
    .map((t) =>
      t.role === "user"
        ? { role: "user", content: t.content.slice(0, MAX_INPUT_CHARS) }
        : t
    );

  const seedCode =
    typeof body.seedCode === "string" && /^\d{10,14}$/.test(body.seedCode.trim())
      ? body.seedCode.trim()
      : null;

  const roll = resolveRollForHistory(history, seedCode);
  const consequence = resolveActionConsequence(history);
  const messages = buildGameMessages(history, seedCode, roll, consequence);

  const rollHeader = roll
    ? roll.fired
      ? `${roll.table}/${roll.tier}`
      : "none"
    : "opening";

  let upstream: Response;
  try {
    upstream = await fetch(`${llm.url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llm.apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: llm.model,
        messages,
        temperature: llm.provider === "openai" ? 1.0 : 1.05,
        top_p: 0.95,
        max_tokens: 1400,
        stream: true,
        ...llm.extraBody,
      }),
    });
  } catch (err) {
    return new Response(
      `SIGNAL LOST: could not reach the world engine. ${String(err)}`,
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(
      `THE WORLD REFUSES TO LOAD [${upstream.status}]. ${detail.slice(0, 300)}`,
      { status: 502 }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              controller.close();
              return;
            }
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta;
              let piece: string | undefined = delta?.content;
              if (piece) {
                piece = piece.replace(/\s*[—–]\s*/g, ", ");
                controller.enqueue(encoder.encode(piece));
              }
            } catch {
              // Ignore partial/non-JSON keep-alive chunks.
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(`\n\nTRANSMISSION CUT. ${String(err)}`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Random-Roll": rollHeader,
      ...rateLimitHeaders(limited),
    },
  });
}
