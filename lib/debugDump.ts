/** Extract and organize engine debug dumps from session history. */

import {
  annotateGameMessages,
  buildGameMessages,
} from "@/lib/gameMessages";
import {
  extractConditionsFromState,
  formatConditionsGuide,
  formatConditionsOverview,
} from "@/lib/conditions";
import {
  extractCharactersFromState,
  extractCharacterPromptExcerpts,
  formatCharacterStorageGuide,
  formatCharactersOverview,
} from "@/lib/characterDebug";
import {
  extractStoriesFromState,
  extractStoryPromptExcerpts,
  formatStoriesOverview,
  formatStoryStorageGuide,
} from "@/lib/storyDebug";
import {
  extractRandomnessFromState,
  formatRandomnessGuide,
  formatRollOverview,
} from "@/lib/randomness";
import { resolveActionConsequence } from "@/lib/actionConsequence";
import { resolveRollForHistory } from "@/lib/rollContext";
import {
  extractSceneBlock,
  extractStateJson,
  extractWorldBlock,
} from "@/lib/stateParse";
import {
  formatSyncTimingTable,
  type SyncTimingRecord,
} from "@/lib/syncTiming";

export { extractStateJson } from "@/lib/stateParse";

export type DebugSection = {
  id: string;
  title: string;
  body: string;
  /** Prefer monospace / JSON highlighting feel */
  kind?: "json" | "text" | "prompt";
};

export type SessionDebugMeta = {
  engineVersion?: string;
  model?: string | null;
  provider?: string | null;
  seedCode: string | null;
  dialCode?: string | null;
  instanceId?: string | null;
  turnCount: number;
  assistantTurns: number;
  ended: boolean;
  softEnded: boolean;
  endLabel: string | null;
  worldReady: boolean;
  sceneReady?: boolean;
  worldHydrating?: boolean;
  syncTimings?: SyncTimingRecord[];
};

type Turn = { role: "user" | "assistant"; content: string };

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function lastAssistant(history: Turn[]): Turn | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") return history[i];
  }
  return null;
}

function firstAssistant(history: Turn[]): Turn | null {
  for (const t of history) {
    if (t.role === "assistant") return t;
  }
  return null;
}

export function buildDebugSections(opts: {
  history: Turn[];
  meta: SessionDebugMeta;
  systemPrompt: string | null;
  openingInstruction: string | null;
  worldSpecJson?: string | null;
  seedDialTable?: string | null;
  seedCode?: string | null;
}): DebugSection[] {
  const {
    history,
    meta,
    systemPrompt,
    openingInstruction,
    worldSpecJson,
    seedDialTable,
    seedCode = meta.seedCode,
  } = opts;
  const sections: DebugSection[] = [];

  sections.push({
    id: "session",
    title: "01 · Session",
    kind: "json",
    body: pretty({
      engineVersion: meta.engineVersion ?? null,
      model: meta.model ?? null,
      provider: meta.provider ?? null,
      seedCode: meta.seedCode,
      dialCode: meta.dialCode ?? null,
      instanceId: meta.instanceId ?? null,
      turnCount: meta.turnCount,
      assistantTurns: meta.assistantTurns,
      ended: meta.ended,
      softEnded: meta.softEnded,
      endLabel: meta.endLabel,
      worldReady: meta.worldReady,
      historyLength: history.length,
      syncTiming: meta.syncTimings?.length
        ? {
            lastTurn: meta.syncTimings[meta.syncTimings.length - 1],
            turnCount: meta.syncTimings.length,
          }
        : null,
    }),
  });

  if (meta.syncTimings && meta.syncTimings.length > 0) {
    sections.push({
      id: "sync-timing",
      title: "Sync timing",
      kind: "text",
      body: formatSyncTimingTable(meta.syncTimings),
    });
  }

  if (seedDialTable) {
    sections.push({
      id: "seed-dials",
      title: "02 · Seed dials (10 axes)",
      kind: "text",
      body: seedDialTable,
    });
  }

  if (worldSpecJson) {
    sections.push({
      id: "worldspec",
      title: "03 · WorldSpec (full JSON)",
      kind: "json",
      body: worldSpecJson,
    });
  }

  if (systemPrompt) {
    sections.push({
      id: "system-prompt",
      title: seedDialTable ? "04 · System prompt" : "02 · System prompt",
      kind: "prompt",
      body: systemPrompt,
    });
  }

  if (openingInstruction) {
    sections.push({
      id: "opening",
      title: seedDialTable ? "05 · Opening instruction" : "03 · Opening instruction",
      kind: "prompt",
      body: openingInstruction,
    });
  }

  if (systemPrompt) {
    sections.push({
      id: "story-prompt-rules",
      title: seedDialTable ? "06 · Story rules (prompt excerpts)" : "04 · Story rules (prompt excerpts)",
      kind: "prompt",
      body: extractStoryPromptExcerpts(systemPrompt),
    });
  }

  sections.push({
    id: "story-storage-guide",
    title: seedDialTable ? "07 · Stories — storage & prompt flow" : "05 · Stories — storage & prompt flow",
    kind: "text",
    body: formatStoryStorageGuide(),
  });

  sections.push({
    id: "conditions-guide",
    title: seedDialTable ? "08 · Conditions — kinds & death paths" : "06 · Conditions — kinds & death paths",
    kind: "text",
    body: formatConditionsGuide(),
  });

  sections.push({
    id: "character-storage-guide",
    title: seedDialTable ? "10 · Characters — storage & combat rules" : "08 · Characters — storage & combat rules",
    kind: "text",
    body: formatCharacterStorageGuide(),
  });

  sections.push({
    id: "randomness-guide",
    title: seedDialTable ? "11 · Randomness — hybrid rolls" : "09 · Randomness — hybrid rolls",
    kind: "text",
    body: formatRandomnessGuide(),
  });

  const pendingRoll = resolveRollForHistory(history, seedCode);
  const pendingConsequence = resolveActionConsequence(history);
  sections.push({
    id: "random-roll",
    title: seedDialTable ? "10 · Random roll (next turn)" : "08 · Random roll (next turn)",
    kind: "text",
    body: pendingRoll
      ? `${formatRollOverview(pendingRoll)}\n\n--- prompt block ---\n${pendingRoll.prompt_block}`
      : "(no player action yet — roll fires after first command)",
  });

  sections.push({
    id: "action-consequence",
    title: seedDialTable ? "11 · Action consequence (next turn)" : "09 · Action consequence (next turn)",
    kind: "text",
    body: pendingConsequence?.fired
      ? `FIRED [${pendingConsequence.kind}]\n${JSON.stringify(pendingConsequence.debug ?? {}, null, 2)}\n\n--- prompt block ---\n${pendingConsequence.prompt_block}`
      : "(not active — fires on authority assault, lethal rash acts, combat loops, or detention stasis)",
  });

  const payloadMessages = buildGameMessages(
    history,
    seedCode,
    pendingRoll,
    pendingConsequence
  );
  const payloadNotes = annotateGameMessages(payloadMessages);
  sections.push({
    id: "llm-payload",
    title: seedDialTable ? "11 · LLM payload (next request)" : "09 · LLM payload (next request)",
    kind: "json",
    body: pretty({
      note: "Messages sent on the next /api/game call. Only the latest assistant turn keeps [WORLD]/STATE (stories). Older assistant turns are SCENE-only.",
      message_count: payloadMessages.length,
      messages: payloadNotes,
      full_messages: payloadMessages,
    }),
  });

  const last = lastAssistant(history);
  let sectionNum = sections.length;
  const nextTitle = (label: string) => {
    sectionNum += 1;
    return `${String(sectionNum).padStart(2, "0")} · ${label}`;
  };

  if (!last) {
    sections.push({
      id: "empty",
      title: nextTitle("Latest turn"),
      kind: "text",
      body: "(no assistant turn yet — start or wait for the opening)",
    });
    return sections;
  }

  const scene = extractSceneBlock(last.content);
  const world = extractWorldBlock(last.content);
  const state = extractStateJson(last.content);

  sections.push({
    id: "latest-scene",
    title: nextTitle("Latest SCENE"),
    kind: "text",
    body: scene ?? "(no [SCENE] block)",
  });

  sections.push({
    id: "latest-world-raw",
    title: nextTitle("Latest WORLD (raw)"),
    kind: "text",
    body: world ?? "(no [WORLD] block)",
  });

  sections.push({
    id: "state-json",
    title: nextTitle("STATE (parsed JSON)"),
    kind: "json",
    body: state
      ? pretty(state)
      : "(could not parse STATE JSON — see raw WORLD above)",
  });

  if (systemPrompt) {
    sections.push({
      id: "character-prompt-rules",
      title: seedDialTable ? "12 · Character rules (prompt excerpts)" : "10 · Character rules (prompt excerpts)",
      kind: "prompt",
      body: extractCharacterPromptExcerpts(systemPrompt),
    });
  }

  const storyBundle = state ? extractStoriesFromState(state) : null;
  const characterBundle = state ? extractCharactersFromState(state) : null;
  sections.push({
    id: "characters-overview",
    title: nextTitle("Characters (current turn overview)"),
    kind: "text",
    body: formatCharactersOverview(characterBundle, { label: "LATEST STATE" }),
  });

  sections.push({
    id: "characters-json",
    title: nextTitle("Characters (JSON roster)"),
    kind: "json",
    body: characterBundle
      ? pretty(characterBundle.characters)
      : "(no characters — STATE missing or unparseable)",
  });

  sections.push({
    id: "stories-overview",
    title: nextTitle("Stories (current turn overview)"),
    kind: "text",
    body: formatStoriesOverview(storyBundle, { label: "LATEST STATE" }),
  });

  const conditionBundle = state ? extractConditionsFromState(state) : null;
  const randomBundle = state ? extractRandomnessFromState(state) : null;
  sections.push({
    id: "conditions-overview",
    title: nextTitle("Conditions (active overview)"),
    kind: "text",
    body: formatConditionsOverview(
      conditionBundle ?? { player: [], npc: [], all: [] }
    ),
  });

  sections.push({
    id: "conditions-json",
    title: nextTitle("Conditions (JSON)"),
    kind: "json",
    body: conditionBundle
      ? pretty({
          top_level: (state as Record<string, unknown>)?.conditions ?? [],
          player: (state as Record<string, unknown>)?.player
            ? ((state as Record<string, unknown>).player as Record<string, unknown>)
                .conditions ?? []
            : [],
          by_subject: {
            player: conditionBundle.player,
            npcs: conditionBundle.npc,
          },
          all: conditionBundle.all,
        })
      : "(no conditions — STATE missing or unparseable)",
  });

  sections.push({
    id: "randomness-state",
    title: nextTitle("Randomness (STATE log)"),
    kind: "json",
    body: randomBundle
      ? pretty(randomBundle)
      : "(no randomness state yet)",
  });

  sections.push({
    id: "stories-json",
    title: nextTitle("Stories (JSON bundle)"),
    kind: "json",
    body: storyBundle
      ? pretty(storyBundle)
      : "(no story bundle — STATE missing or unparseable)",
  });

  const first = firstAssistant(history);
  const firstState = first ? extractStateJson(first.content) : null;
  const firstStories = firstState ? extractStoriesFromState(firstState) : null;
  if (firstStories && first !== last) {
    sections.push({
      id: "stories-at-gen",
      title: nextTitle("Stories at gen (turn 1 STATE)"),
      kind: "text",
      body: formatStoriesOverview(firstStories, {
        label: "TURN 1 / SHARE BIBLE",
        turnHint: " — seeded at world creation",
      }),
    });
    sections.push({
      id: "stories-at-gen-json",
      title: nextTitle("Stories at gen (JSON)"),
      kind: "json",
      body: pretty(firstStories),
    });
  }

  if (state && typeof state === "object" && state !== null) {
    const s = state as Record<string, unknown>;
    const slices: [string, string, unknown][] = [
      ["player", "Player", s.player],
      ["characters", "Characters", s.characters],
      ["laws", "Laws (discoverable)", s.laws],
      ["conditions-slice", "Conditions (raw slices)", {
        conditions: s.conditions,
        player_conditions: (s.player as Record<string, unknown> | undefined)
          ?.conditions,
      }],
      ["heat", "Heat / wanted", s.heat],
      ["locations", "Locations", {
        player_location: s.player_location,
        locations: s.locations,
      }],
      ["starting-plot", "Starting plot", s.starting_plot ?? s.main_plot],
      ["threads", "Threads", s.threads],
      ["consequences", "Consequences", s.consequences],
      ["end-clauses", "End clauses / end_state", {
        end_clauses: s.end_clauses,
        end_state: s.end_state,
        active_track: s.active_track,
      }],
      ["ambient", "Ambient / timeline / clock", {
        ambient_hooks: s.ambient_hooks,
        timeline: s.timeline,
        clock: s.clock,
        world_type: s.world_type,
      }],
    ];
    for (const [id, label, value] of slices) {
      if (value === undefined) continue;
      sections.push({
        id,
        title: nextTitle(label),
        kind: "json",
        body: pretty(value),
      });
    }
  }

  sections.push({
    id: "history",
    title: nextTitle("Full history (all turns)"),
    kind: "json",
    body: pretty(
      history.map((t, i) => ({
        i,
        role: t.role,
        chars: t.content.length,
        content: t.content,
      }))
    ),
  });

  return sections;
}

export function formatFullDump(sections: DebugSection[]): string {
  return sections
    .map(
      (s) =>
        `${"=".repeat(72)}\n${s.title}\n${"=".repeat(72)}\n\n${s.body}\n`
    )
    .join("\n");
}
