import type { ClientTurn } from "@/lib/gameMessages";
import { computeHybridRoll, type RandomRollResult } from "@/lib/randomness";
import { extractStateJson } from "@/lib/stateParse";
import { decodeSeed } from "@/lib/worldSpec";

function lastUserAction(history: ClientTurn[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return history[i].content;
  }
  return null;
}

function lastAssistantRaw(history: ClientTurn[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") return history[i].content;
  }
  return null;
}

/** Compute hybrid random roll for the next engine response (API + debug). */
export function resolveRollForHistory(
  history: ClientTurn[],
  seedCode?: string | null
): RandomRollResult | null {
  const action = lastUserAction(history);
  if (!action) return null;

  const lastRaw = lastAssistantRaw(history);
  const state = lastRaw ? extractStateJson(lastRaw) : null;
  const clock =
    state && typeof state === "object" && state !== null
      ? (state as Record<string, unknown>).clock
      : null;
  const turn =
    clock &&
    typeof clock === "object" &&
    clock !== null &&
    Number.isFinite((clock as Record<string, unknown>).turn)
      ? Number((clock as Record<string, unknown>).turn) + 1
      : history.filter((t) => t.role === "user").length;

  const spec = seedCode ? decodeSeed(seedCode) : null;
  return computeHybridRoll({
    seedCode,
    turn,
    playerAction: action,
    spec,
    state,
  });
}
