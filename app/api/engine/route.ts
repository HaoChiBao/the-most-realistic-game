import { ENGINE_VERSION } from "@/lib/systemPrompt";
import { getProviderBanner } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    version: ENGINE_VERSION,
    banner: getProviderBanner(),
  });
}
