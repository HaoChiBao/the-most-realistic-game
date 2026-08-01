/**
 * Player-facing story chronicle — what has happened so far.
 *
 * Distinct from STATE.timeline (engine off-screen / scheduled beats, often spoilers).
 * This panel only surfaces events the player has already experienced.
 */

import { extractCharactersFromState } from "@/lib/characterDebug";
import { extractSceneBlock, extractStateJson } from "@/lib/stateParse";

export type TimelineEventKind =
  | "session"
  | "action"
  | "scene"
  | "intro"
  | "memory"
  | "random"
  | "beat"
  | "consequence"
  | "heat"
  | "location"
  | "end"
  | "chronicle";

export type TimelineEvent = {
  id: string;
  turn: number;
  kind: TimelineEventKind;
  label: string;
  detail?: string;
  /** Optional subject (NPC name, location id, etc.) */
  subject?: string;
};

export type PlayerTimeline = {
  currentTurn: number;
  timeOfDay: string | null;
  location: string | null;
  events: TimelineEvent[];
};

type Turn = { role: "user" | "assistant"; content: string };

const KIND_ORDER: Record<TimelineEventKind, number> = {
  session: 0,
  location: 1,
  intro: 2,
  action: 3,
  scene: 4,
  memory: 5,
  random: 6,
  beat: 7,
  consequence: 8,
  heat: 9,
  chronicle: 10,
  end: 11,
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function clockFromState(state: unknown): { turn: number; timeOfDay: string | null } {
  const s = asRecord(state);
  const clock = asRecord(s?.clock);
  const turn =
    typeof clock?.turn === "number" && Number.isFinite(clock.turn)
      ? Math.max(1, Math.floor(clock.turn))
      : 1;
  const timeOfDay =
    clock?.time_of_day != null ? String(clock.time_of_day) : null;
  return { turn, timeOfDay };
}

function shortText(raw: string, max = 140): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

function sceneSummary(raw: string): string | null {
  const scene = extractSceneBlock(raw);
  if (!scene) return null;
  const cleaned = scene
    .replace(/<ENDLABEL>[\s\S]*?<\/ENDLABEL>/gi, "")
    .replace(/<\/?(?:SOFT_)?END>/gi, "")
    .trim();
  if (!cleaned) return null;
  // Prefer first sentence-ish chunk.
  const sentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
  return shortText(sentence, 160);
}

function pushUnique(events: TimelineEvent[], event: TimelineEvent) {
  if (events.some((e) => e.id === event.id)) return;
  events.push(event);
}

function parseChronicleEntries(
  state: unknown,
  currentTurn: number
): TimelineEvent[] {
  const s = asRecord(state);
  const raw = Array.isArray(s?.chronicle) ? s.chronicle : [];
  const out: TimelineEvent[] = [];
  raw.forEach((entry, i) => {
    const o = asRecord(entry);
    if (!o) return;
    const turn =
      typeof o.turn === "number" && Number.isFinite(o.turn)
        ? Math.floor(o.turn)
        : currentTurn;
    if (turn > currentTurn) return;
    const label =
      o.label != null
        ? String(o.label)
        : o.event != null
          ? String(o.event)
          : o.beat != null
            ? String(o.beat)
            : null;
    if (!label) return;
    const kindRaw = o.kind != null ? String(o.kind) : "chronicle";
    const kind = (
      [
        "session",
        "action",
        "scene",
        "intro",
        "memory",
        "random",
        "beat",
        "consequence",
        "heat",
        "location",
        "end",
        "chronicle",
      ] as TimelineEventKind[]
    ).includes(kindRaw as TimelineEventKind)
      ? (kindRaw as TimelineEventKind)
      : "chronicle";
    out.push({
      id: `chronicle-${turn}-${i}-${label.slice(0, 24)}`,
      turn,
      kind,
      label: shortText(label, 120),
      detail: o.detail != null ? shortText(String(o.detail), 200) : undefined,
      subject: o.subject != null ? String(o.subject) : undefined,
    });
  });
  return out;
}

/** Build a chronological player-visible timeline from session history + STATE. */
export function buildPlayerTimeline(history: Turn[]): PlayerTimeline {
  const events: TimelineEvent[] = [];

  let lastState: unknown = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "assistant") continue;
    lastState = extractStateJson(history[i].content);
    if (lastState) break;
  }

  const { turn: currentTurn, timeOfDay } = clockFromState(lastState);
  const stateRec = asRecord(lastState);
  const location =
    stateRec?.player_location != null
      ? String(stateRec.player_location)
      : null;

  pushUnique(events, {
    id: "session-start",
    turn: 1,
    kind: "session",
    label: "Session begins",
    detail: "You wake into a new world.",
  });

  // LLM-authored chronicle entries (preferred when present).
  for (const ev of parseChronicleEntries(lastState, currentTurn)) {
    pushUnique(events, ev);
  }

  // Derive from chat history: player actions + scene beats.
  let pendingAction: string | null = null;
  let lastLocation: string | null = null;
  for (const turn of history) {
    if (turn.role === "user") {
      const text = turn.content.trim();
      // Skip opening / hydration engine instructions.
      if (
        /PHASE A|PHASE B|HYDRATION PASS|Begin a new session/i.test(text) ||
        text.startsWith("WORLDSPEC") ||
        text.length > 200
      ) {
        continue;
      }
      pendingAction = text;
      continue;
    }

    const state = extractStateJson(turn.content);
    const clock = clockFromState(state);

    if (pendingAction) {
      pushUnique(events, {
        id: `action-${clock.turn}-${pendingAction.slice(0, 32)}`,
        turn: clock.turn,
        kind: "action",
        label: shortText(pendingAction, 100),
        detail: "Your action",
      });
      pendingAction = null;
    }

    const scene = sceneSummary(turn.content);
    if (scene && !/HYDRATION|WORLD-only/i.test(scene)) {
      pushUnique(events, {
        id: `scene-${clock.turn}-${scene.slice(0, 40)}`,
        turn: clock.turn,
        kind: "scene",
        label: scene,
      });
    }

    const locRec = asRecord(state);
    const loc =
      locRec?.player_location != null
        ? String(locRec.player_location)
        : null;
    if (loc && loc !== lastLocation) {
      pushUnique(events, {
        id: `location-${clock.turn}-${loc}`,
        turn: clock.turn,
        kind: "location",
        label: `Arrived: ${loc.replace(/_/g, " ")}`,
        subject: loc,
      });
      lastLocation = loc;
    }

    // Soft / hard end markers from this turn.
    if (/<END>/i.test(turn.content) && !/<SOFT_END>/i.test(turn.content)) {
      const labelM = turn.content.match(
        /<ENDLABEL>([\s\S]*?)<\/ENDLABEL>/i
      );
      pushUnique(events, {
        id: `end-hard-${clock.turn}`,
        turn: clock.turn,
        kind: "end",
        label: labelM ? shortText(labelM[1], 80) : "Hard ending",
        detail: "Session ended",
      });
    } else if (/<SOFT_END>/i.test(turn.content)) {
      const labelM = turn.content.match(
        /<ENDLABEL>([\s\S]*?)<\/ENDLABEL>/i
      );
      pushUnique(events, {
        id: `end-soft-${clock.turn}`,
        turn: clock.turn,
        kind: "end",
        label: labelM ? shortText(labelM[1], 80) : "Plot beat resolved",
        detail: "Soft ending — world continues",
      });
    }
  }

  // Orphan action with no assistant reply yet.
  if (pendingAction) {
    pushUnique(events, {
      id: `action-pending-${pendingAction.slice(0, 32)}`,
      turn: currentTurn,
      kind: "action",
      label: shortText(pendingAction, 100),
      detail: "Your action",
    });
  }

  // Character intros + known NPC memories from latest STATE.
  const chars = extractCharactersFromState(lastState);
  if (chars) {
    for (const c of chars.characters) {
      if (c.known_to_player === false) continue;
      // Prefer earned name; legacy sheets without player_knowledge keep prior labels.
      const hasPk = c.player_knowledge != null;
      const nameKnown = hasPk
        ? c.player_knowledge!.name_known === true
        : !!c.name;
      const roleKnown = hasPk
        ? c.player_knowledge!.role_known === true
        : !!c.role;
      const labelName = nameKnown
        ? (c.name ?? c.id)
        : c.appearance
          ? shortText(String(c.appearance), 40)
          : "a stranger";
      const introTurn = c.introduced_turn ?? 1;
      if (introTurn <= currentTurn) {
        pushUnique(events, {
          id: `intro-${c.id}`,
          turn: introTurn,
          kind: "intro",
          label: nameKnown ? `Met ${labelName}` : `Noticed ${labelName}`,
          detail:
            [roleKnown ? c.role : null, c.archetype]
              .filter(Boolean)
              .join(" · ") || undefined,
          subject: c.id,
        });
      }
      for (const mem of c.memory ?? []) {
        if (mem.turn > currentTurn) continue;
        pushUnique(events, {
          id: `memory-${c.id}-${mem.turn}-${mem.event.slice(0, 32)}`,
          turn: mem.turn,
          kind: "memory",
          label: shortText(mem.event, 120),
          detail: `${labelName}${mem.emotional_weight ? ` · ${mem.emotional_weight}` : ""}`,
          subject: c.id,
        });
      }
    }
  }

  // Past engine timeline beats only (never future spoilers).
  const timeline = Array.isArray(stateRec?.timeline) ? stateRec.timeline : [];
  timeline.forEach((beat, i) => {
    const o = asRecord(beat);
    if (!o) return;
    const at =
      typeof o.at_turn === "number"
        ? o.at_turn
        : typeof o.turn === "number"
          ? o.turn
          : null;
    if (at == null || at > currentTurn) return;
    const label =
      o.beat != null
        ? String(o.beat)
        : o.event != null
          ? String(o.event)
          : o.label != null
            ? String(o.label)
            : null;
    if (!label) return;
    pushUnique(events, {
      id: `beat-${at}-${i}-${label.slice(0, 24)}`,
      turn: at,
      kind: "beat",
      label: shortText(label, 120),
      detail: "World event",
    });
  });

  // Random events that already fired.
  const randomLog = Array.isArray(stateRec?.random_log)
    ? stateRec.random_log
    : [];
  randomLog.forEach((entry, i) => {
    const o = asRecord(entry);
    if (!o) return;
    const at =
      typeof o.turn === "number"
        ? o.turn
        : typeof o.at_turn === "number"
          ? o.at_turn
          : currentTurn;
    if (at > currentTurn) return;
    const label =
      o.event != null
        ? String(o.event)
        : o.summary != null
          ? String(o.summary)
          : o.tier != null
            ? `Random event (${o.tier})`
            : null;
    if (!label) return;
    pushUnique(events, {
      id: `random-${at}-${i}`,
      turn: at,
      kind: "random",
      label: shortText(label, 120),
      detail: o.table != null ? `Table: ${String(o.table)}` : "Chance event",
    });
  });

  // Persistent consequences (player-visible fallout tags).
  const consequences = Array.isArray(stateRec?.consequences)
    ? stateRec.consequences
    : [];
  consequences.forEach((entry, i) => {
    const o = asRecord(entry);
    if (!o) {
      if (typeof entry === "string" && entry.trim()) {
        pushUnique(events, {
          id: `consequence-str-${i}`,
          turn: currentTurn,
          kind: "consequence",
          label: shortText(entry, 120),
        });
      }
      return;
    }
    const at =
      typeof o.turn === "number"
        ? o.turn
        : typeof o.at_turn === "number"
          ? o.at_turn
          : currentTurn;
    if (at > currentTurn) return;
    const label =
      o.label != null
        ? String(o.label)
        : o.id != null
          ? String(o.id).replace(/_/g, " ")
          : o.summary != null
            ? String(o.summary)
            : null;
    if (!label) return;
    pushUnique(events, {
      id: `consequence-${at}-${i}-${label.slice(0, 24)}`,
      turn: at,
      kind: "consequence",
      label: shortText(label, 120),
      detail: o.detail != null ? shortText(String(o.detail), 160) : "Fallout",
    });
  });

  // Heat response when something is actually happening.
  const heat = asRecord(stateRec?.heat);
  if (heat?.response && String(heat.response) !== "none") {
    pushUnique(events, {
      id: `heat-${String(heat.response)}`,
      turn: currentTurn,
      kind: "heat",
      label: `Heat: ${String(heat.response).replace(/_/g, " ")}`,
      detail:
        typeof heat.level === "number" ? `Level ${heat.level}` : undefined,
    });
  }

  events.sort((a, b) => {
    if (a.turn !== b.turn) return a.turn - b.turn;
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });

  return {
    currentTurn,
    timeOfDay,
    location,
    events,
  };
}

export function timelineKindLabel(kind: TimelineEventKind): string {
  switch (kind) {
    case "session":
      return "start";
    case "action":
      return "you";
    case "scene":
      return "scene";
    case "intro":
      return "met";
    case "memory":
      return "npc";
    case "random":
      return "chance";
    case "beat":
      return "world";
    case "consequence":
      return "fallout";
    case "heat":
      return "heat";
    case "location":
      return "place";
    case "end":
      return "end";
    case "chronicle":
      return "note";
    default:
      return kind;
  }
}
