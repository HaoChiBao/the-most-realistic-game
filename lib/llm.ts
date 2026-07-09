// LLM provider config. OpenAI is preferred when OPENAI_API_KEY is set.

export type LlmProvider = "openai" | "nim";

export type LlmConfig = {
  provider: LlmProvider;
  url: string;
  apiKey: string;
  model: string;
  extraBody: Record<string, unknown>;
};

export function getLlmConfig(): LlmConfig | null {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      provider: "openai",
      url: (
        process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
      ).replace(/\/$/, ""),
      apiKey: openaiKey,
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
      extraBody: {},
    };
  }

  const nimKey = process.env.NIM_API_KEY?.trim();
  if (nimKey) {
    return {
      provider: "nim",
      url: (
        process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1"
      ).replace(/\/$/, ""),
      apiKey: nimKey,
      model: process.env.NIM_MODEL?.trim() || "deepseek-ai/deepseek-v4-pro",
      extraBody: { reasoning_effort: "none" },
    };
  }

  return null;
}

// Human-readable model id stored alongside shared seeds.
export function getModelLabel(): string {
  return getLlmConfig()?.model ?? "unknown";
}

// Short label for the terminal boot banner.
export function getProviderBanner(): string {
  const cfg = getLlmConfig();
  if (!cfg) return "OFFLINE";
  if (cfg.provider === "openai") return cfg.model.toUpperCase();
  return "DEEPSEEK CORE";
}
