import {
  ENGINE_VERSION,
  OPENING_INSTRUCTION,
  SYSTEM_PROMPT,
} from "@/lib/systemPrompt";
import { getProviderBanner } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  return Response.json({
    version: ENGINE_VERSION,
    banner: getProviderBanner(),
    ...(debug
      ? {
          systemPrompt: SYSTEM_PROMPT,
          openingInstruction: OPENING_INSTRUCTION,
        }
      : {}),
  });
}
