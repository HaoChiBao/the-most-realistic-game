import { OPENING_INSTRUCTION, SYSTEM_PROMPT } from "@/lib/systemPrompt";
import type { RandomRollResult } from "@/lib/randomness";
import type { CombatEscalationResult } from "@/lib/combatContext";
import { buildOpeningInstruction, decodeSeed } from "@/lib/worldSpec";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ClientTurn = { role: "user" | "assistant"; content: string };

const MAX_HISTORY = 40;
/** Exported for API route + client — LLM only ever sees this many turns. */
export const MAX_HISTORY_MESSAGES = MAX_HISTORY;

export function stripWorld(content: string): string {
  const idx = content.indexOf("[WORLD]");
  const scene = idx === -1 ? content : content.slice(0, idx);
  return scene.replace("[SCENE]", "").trim();
}

/** Build the chat messages array sent to the LLM for the current history. */
export function buildGameMessages(
  history: ClientTurn[],
  seedCode?: string | null,
  roll?: RandomRollResult | null,
  combat?: CombatEscalationResult | null
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  const trimmed = history.slice(-MAX_HISTORY);
  if (trimmed.length === 0 || trimmed[0].role !== "user") {
    const spec = seedCode ? decodeSeed(seedCode) : null;
    messages.push({
      role: "user",
      content: buildOpeningInstruction(OPENING_INSTRUCTION, spec),
    });
  }

  let lastAssistant = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i].role === "assistant") lastAssistant = i;
  }

  for (let i = 0; i < trimmed.length; i++) {
    const turn = trimmed[i];
    let content = String(turn.content ?? "");
    if (turn.role === "assistant" && i !== lastAssistant) {
      content = stripWorld(content);
    }
    if (
      turn.role === "user" &&
      i === trimmed.length - 1 &&
      trimmed[trimmed.length - 1]?.role === "user"
    ) {
      const injections: string[] = [];
      if (combat?.fired) injections.push(combat.prompt_block);
      if (roll) injections.push(roll.prompt_block);
      if (injections.length > 0) {
        content = `${content}\n\n${injections.join("\n\n")}`;
      }
    }
    content = content.slice(0, 8000);
    if (!content) continue;
    messages.push({ role: turn.role, content });
  }

  return messages;
}

export type MessagePayloadNote = {
  index: number;
  role: string;
  chars: number;
  world_block: boolean;
  state_json: boolean;
  story_keys_present: string[];
  content_preview: string;
};

const STORY_KEY_MARKERS = [
  "starting_plot",
  "main_plot",
  '"threads"',
  "ambient_hooks",
  "timeline",
  "end_clauses",
  "active_track",
] as const;

function storyKeysInContent(content: string): string[] {
  return STORY_KEY_MARKERS.filter((k) => content.includes(k));
}

/** Annotate each LLM message for debug — shows how stories ride in the payload. */
export function annotateGameMessages(messages: ChatMessage[]): MessagePayloadNote[] {
  return messages.map((m, index) => ({
    index,
    role: m.role,
    chars: m.content.length,
    world_block: m.content.includes("[WORLD]"),
    state_json: /\bSTATE\s*\n/i.test(m.content),
    story_keys_present: storyKeysInContent(m.content),
    content_preview:
      m.role === "system"
        ? "(full system prompt — see System prompt section)"
        : m.content.length > 400
          ? `${m.content.slice(0, 400)}…`
          : m.content,
  }));
}
