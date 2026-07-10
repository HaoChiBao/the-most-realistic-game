import { ENGINE_VERSION } from "@/lib/systemPrompt";

export const SESSION_STORAGE_KEY = "tmrg_session";
const SAVE_VERSION = 1;

export type SavedTurn = { role: "user" | "assistant"; content: string };

export type SavedEntry = {
  id: number;
  type: "system" | "engine" | "player" | "error" | "diverge";
  text: string;
};

export type SavedSession = {
  version: number;
  engineVersion: string;
  savedAt: string;
  seedCode: string | null;
  history: SavedTurn[];
  entries: SavedEntry[];
  nextEntryId: number;
  ended: boolean;
  softEnded?: boolean;
  endLabel: string | null;
  worldReady: boolean;
  openingWorld: SavedTurn | null;
};

export function saveSession(session: SavedSession): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function loadSession(): SavedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (
      parsed.version !== SAVE_VERSION ||
      parsed.engineVersion !== ENGINE_VERSION ||
      !Array.isArray(parsed.history) ||
      !Array.isArray(parsed.entries)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasSavedSession(): boolean {
  return loadSession() !== null;
}

export function canRestoreSession(
  saved: SavedSession,
  seedCode?: string
): boolean {
  if (saved.history.length === 0) return false;
  if (!seedCode) return true;
  return saved.seedCode === seedCode;
}

export function buildSessionSnapshot(state: {
  seedCode: string | null;
  history: SavedTurn[];
  entries: SavedEntry[];
  nextEntryId: number;
  ended: boolean;
  softEnded?: boolean;
  endLabel: string | null;
  worldReady: boolean;
  openingWorld: SavedTurn | null;
}): SavedSession {
  return {
    version: SAVE_VERSION,
    engineVersion: ENGINE_VERSION,
    savedAt: new Date().toISOString(),
    seedCode: state.seedCode,
    history: state.history.map((t) => ({ ...t })),
    entries: state.entries.map((e) => ({ ...e })),
    nextEntryId: state.nextEntryId,
    ended: state.ended,
    softEnded: state.softEnded ?? false,
    endLabel: state.endLabel,
    worldReady: state.worldReady,
    openingWorld: state.openingWorld ? { ...state.openingWorld } : null,
  };
}
