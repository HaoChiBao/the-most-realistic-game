/** Extract and organize engine debug dumps from session history. */

export type DebugSection = {
  id: string;
  title: string;
  body: string;
  /** Prefer monospace / JSON highlighting feel */
  kind?: "json" | "text" | "prompt";
};

export type SessionDebugMeta = {
  engineVersion?: string;
  seedCode: string | null;
  dialCode?: string | null;
  instanceId?: string | null;
  turnCount: number;
  assistantTurns: number;
  ended: boolean;
  softEnded: boolean;
  endLabel: string | null;
  worldReady: boolean;
};

type Turn = { role: "user" | "assistant"; content: string };

function extractWorldBlock(content: string): string | null {
  const m = content.match(/\[\s*WORLD\s*\]/i);
  if (!m || m.index === undefined) return null;
  return content.slice(m.index + m[0].length).trim();
}

function extractSceneBlock(content: string): string | null {
  const sceneM = content.match(/\[\s*SCENE\s*\]/i);
  const worldM = content.match(/\[\s*WORLD\s*\]/i);
  if (!sceneM || sceneM.index === undefined) {
    if (worldM && worldM.index !== undefined) {
      return content.slice(0, worldM.index).trim() || null;
    }
    return null;
  }
  const start = sceneM.index + sceneM[0].length;
  const end =
    worldM && worldM.index !== undefined && worldM.index > sceneM.index
      ? worldM.index
      : content.length;
  return content.slice(start, end).trim() || null;
}

/** Pull the JSON object after a bare `STATE` line inside [WORLD]. */
export function extractStateJson(worldOrRaw: string): unknown | null {
  const world = extractWorldBlock(worldOrRaw) ?? worldOrRaw;
  const stateLine = world.match(/(?:^|\n)\s*STATE\s*\n/i);
  if (!stateLine || stateLine.index === undefined) {
    // Fallback: first top-level JSON object in the block
    const brace = world.indexOf("{");
    if (brace === -1) return null;
    return tryParseJsonObject(world.slice(brace));
  }
  const after = world.slice(stateLine.index + stateLine[0].length);
  const brace = after.indexOf("{");
  if (brace === -1) return null;
  return tryParseJsonObject(after.slice(brace));
}

function tryParseJsonObject(src: string): unknown | null {
  // Walk braces to find a balanced object (model may append notes after JSON).
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = src.slice(0, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  try {
    return JSON.parse(src);
  } catch {
    return null;
  }
}

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

export function buildDebugSections(opts: {
  history: Turn[];
  meta: SessionDebugMeta;
  systemPrompt: string | null;
  openingInstruction: string | null;
  worldSpecJson?: string | null;
  seedDialTable?: string | null;
}): DebugSection[] {
  const {
    history,
    meta,
    systemPrompt,
    openingInstruction,
    worldSpecJson,
    seedDialTable,
  } = opts;
  const sections: DebugSection[] = [];

  sections.push({
    id: "session",
    title: "01 · Session",
    kind: "json",
    body: pretty({
      engineVersion: meta.engineVersion ?? null,
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
    }),
  });

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

  if (state && typeof state === "object" && state !== null) {
    const s = state as Record<string, unknown>;
    const slices: [string, string, unknown][] = [
      ["player", "Player", s.player],
      ["characters", "Characters", s.characters],
      ["laws", "Laws (discoverable)", s.laws],
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
