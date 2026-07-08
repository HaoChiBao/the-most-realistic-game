import { NextRequest } from "next/server";
import { SYSTEM_PROMPT, OPENING_INSTRUCTION } from "@/lib/systemPrompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NIM_URL =
  process.env.NIM_BASE_URL?.replace(/\/$/, "") ??
  "https://integrate.api.nvidia.com/v1";
const MODEL = process.env.NIM_MODEL ?? "deepseek-ai/deepseek-v4-pro";
const MAX_INPUT_CHARS = 140;
const MAX_HISTORY = 40; // cap how much backstory we replay to the model

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type ClientTurn = { role: "user" | "assistant"; content: string };

function buildMessages(history: ClientTurn[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  const trimmed = history.slice(-MAX_HISTORY);
  if (trimmed.length === 0 || trimmed[0].role !== "user") {
    messages.push({ role: "user", content: OPENING_INSTRUCTION });
  }

  for (const turn of trimmed) {
    const content = String(turn.content ?? "").slice(0, 4000);
    if (!content) continue;
    messages.push({ role: turn.role, content });
  }

  return messages;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.NIM_API_KEY;
  if (!apiKey) {
    return new Response(
      "SYSTEM FAILURE: NIM_API_KEY is not configured on the server.",
      { status: 500 }
    );
  }

  let body: { history?: ClientTurn[] };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history: ClientTurn[] = rawHistory
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

  const messages = buildMessages(history);

  let upstream: Response;
  try {
    upstream = await fetch(`${NIM_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 1.05,
        top_p: 0.95,
        max_tokens: 700,
        stream: true,
        // DeepSeek V4 Pro is a dual-mode model; keep reasoning off so replies
        // stay fast and in-character. Harmless for models that ignore it.
        reasoning_effort: "none",
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
              // Ignore reasoning_content from hybrid/R1 models; only emit prose.
              let piece: string | undefined = delta?.content;
              if (piece) {
                // Backstop: the engine is told never to use em/en dashes;
                // enforce it here too so none can slip through.
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
    },
  });
}
