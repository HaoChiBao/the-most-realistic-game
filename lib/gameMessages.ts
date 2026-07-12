import {
  OPENING_HYDRATION_INSTRUCTION,
  OPENING_PRESENT_INSTRUCTION,
  SYSTEM_PROMPT,
} from "@/lib/systemPrompt";
import type { RandomRollResult } from "@/lib/randomness";
import type { ActionConsequenceResult } from "@/lib/actionConsequence";
import { buildOpeningInstruction, decodeSeed } from "@/lib/worldSpec";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ClientTurn = { role: "user" | "assistant"; content: string };
export type OpeningPhase = "present" | "hydrate";

const MAX_HISTORY = 40;
/** Exported for API route + client — LLM only ever sees this many turns. */
export const MAX_HISTORY_MESSAGES = MAX_HISTORY;

const DELTA_STATE_REMINDER = `[STATE OUTPUT — DELTA ONLY this turn. Your last assistant [WORLD] has the full prior STATE. Emit ONLY changed keys: clock (required, increment turn), player_location if moved, player subfields that changed, characters[] ONLY for NPCs new or changed this turn (always include id), heat/threads/laws/locations only if touched, random_log only new entries. Target <600 chars in the STATE JSON line. Omit every unchanged key. Do NOT rewrite the full schema.]`;

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
  consequence?: ActionConsequenceResult | null,
  openingPhase?: OpeningPhase | null
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  const trimmed = history.slice(-MAX_HISTORY);

  if (openingPhase === "hydrate") {
    const opening = trimmed.find((t) => t.role === "assistant");
    if (!opening) {
      throw new Error("hydrate phase requires an assistant opening turn");
    }
    messages.push({ role: "assistant", content: opening.content.slice(0, 8000) });
    messages.push({
      role: "user",
      content: OPENING_HYDRATION_INSTRUCTION,
    });
    return messages;
  }

  if (trimmed.length === 0 || trimmed[0].role !== "user") {
    const spec = seedCode ? decodeSeed(seedCode) : null;
    const instruction = OPENING_PRESENT_INSTRUCTION;
    messages.push({
      role: "user",
      content: buildOpeningInstruction(instruction, spec),
    });
  }

  let lastAssistant = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i].role === "assistant") lastAssistant = i;
  }
  const hasPriorWorld = lastAssistant !== -1;

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
      if (consequence?.fired) injections.push(consequence.prompt_block);
      if (roll) injections.push(roll.prompt_block);
      if (hasPriorWorld) injections.push(DELTA_STATE_REMINDER);
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
