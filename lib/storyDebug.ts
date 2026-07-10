/**
 * Story / plot observability for the engine debug panel.
 *
 * "Stories" in this engine are not a separate table — they live inside STATE JSON
 * inside the latest assistant [WORLD] block, and in the stored share bible.
 */

export type StoryBundle = {
  active_track: string | null;
  starting_plot: unknown;
  threads: unknown[];
  ambient_hooks: unknown[];
  timeline: unknown[];
  end_clauses: unknown[];
  end_state: unknown;
  consequences: unknown[];
  law_thread_links: { law_id: string; thread_link: unknown }[];
};

export const STORY_STATE_KEYS = [
  {
    key: "starting_plot",
    role: "Seeded tension at gen — ignorable, not a railroad",
    prompt: "Opening instruction + system prompt STARTING PLOT section",
  },
  {
    key: "threads",
    role: "2–4 latent probes / lore hooks (some link to law ids)",
    prompt: "Opening instruction seeds; THREADS AS LAW PROBES in system prompt",
  },
  {
    key: "active_track",
    role: '"starting" or a thread id — which beat the engine tracks',
    prompt: "System prompt STATE schema",
  },
  {
    key: "ambient_hooks",
    role: "Optional flavor nudges (not plot magnets)",
    prompt: "Opening instruction + AMBIENT NUDGES rules",
  },
  {
    key: "timeline",
    role: "Off-screen / scheduled beats advancing each turn",
    prompt: "System prompt TIMELINE / stall handling",
  },
  {
    key: "end_clauses",
    role: "Hard/soft end conditions seeded at gen",
    prompt: "Opening instruction + SOFT VS HARD ENDINGS",
  },
  {
    key: "consequences",
    role: "Persistent fallout flags from player actions",
    prompt: "ACTION IMPLICATIONS + law breach costs",
  },
  {
    key: "laws[].thread_link",
    role: "Links a discoverable law to a thread probe",
    prompt: "DISCOVERABLE LAWS schema + threads as probes",
  },
] as const;

export function extractStoriesFromState(state: unknown): StoryBundle | null {
  if (!state || typeof state !== "object") return null;
  const s = state as Record<string, unknown>;
  const laws = Array.isArray(s.laws) ? s.laws : [];
  const law_thread_links = laws
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .filter((l) => l.thread_link != null && l.thread_link !== "")
    .map((l) => ({
      law_id: String(l.id ?? "?"),
      thread_link: l.thread_link,
    }));

  return {
    active_track: s.active_track != null ? String(s.active_track) : null,
    starting_plot: s.starting_plot ?? s.main_plot ?? null,
    threads: Array.isArray(s.threads) ? s.threads : [],
    ambient_hooks: Array.isArray(s.ambient_hooks) ? s.ambient_hooks : [],
    timeline: Array.isArray(s.timeline) ? s.timeline : [],
    end_clauses: Array.isArray(s.end_clauses) ? s.end_clauses : [],
    end_state: s.end_state ?? null,
    consequences: Array.isArray(s.consequences) ? s.consequences : [],
    law_thread_links,
  };
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeThread(t: unknown, i: number): string {
  if (!t || typeof t !== "object") return `  [${i}] ${fmt(t)}`;
  const o = t as Record<string, unknown>;
  const id = o.id != null ? String(o.id) : `thread_${i}`;
  const parts = [
    `  • ${id}`,
    o.hook != null ? `hook: ${String(o.hook)}` : null,
    o.phase != null ? `phase: ${String(o.phase)}` : null,
    o.law_id != null ? `law_id: ${String(o.law_id)}` : null,
    o.latent != null ? `latent: ${String(o.latent)}` : null,
    o.known_to_player != null
      ? `known_to_player: ${String(o.known_to_player)}`
      : null,
  ].filter(Boolean);
  if (parts.length === 1) return `  [${i}] ${fmt(t)}`;
  return parts.join("\n    ");
}

export function formatStoriesOverview(
  bundle: StoryBundle | null,
  opts?: { label?: string; turnHint?: string }
): string {
  const label = opts?.label ?? "CURRENT TURN";
  const turnHint = opts?.turnHint ?? "";

  if (!bundle) {
    return [
      `STORIES — ${label}${turnHint}`,
      "",
      "(no STATE JSON parsed — stories live inside [WORLD] → STATE)",
      "",
      "Expected keys: starting_plot, threads[], active_track, ambient_hooks[],",
      "timeline[], end_clauses[], consequences[], laws[].thread_link",
    ].join("\n");
  }

  const lines = [
    `STORIES — ${label}${turnHint}`,
    "",
    "WHERE STORED: STATE JSON inside the latest assistant [WORLD] block.",
    "SHARE /s/CODE: turn-1 opening + world bible in DB (exact replay, not regen).",
    "PROMPT: system rules + opening instruction at gen; thereafter full STATE",
    "        only on the LAST assistant turn (older turns strip [WORLD]).",
    "",
    `active_track: ${bundle.active_track ?? "(not set)"}`,
    "",
    "— starting_plot —",
    fmt(bundle.starting_plot),
    "",
    `— threads (${bundle.threads.length}) —`,
    bundle.threads.length
      ? bundle.threads.map(summarizeThread).join("\n")
      : "  (empty — engine should seed 2–4 at gen)",
    "",
    `— ambient_hooks (${bundle.ambient_hooks.length}) —`,
    bundle.ambient_hooks.length
      ? fmt(bundle.ambient_hooks)
      : "  (empty)",
    "",
    `— timeline (${bundle.timeline.length}) —`,
    bundle.timeline.length ? fmt(bundle.timeline) : "  (empty)",
    "",
    `— end_clauses (${bundle.end_clauses.length}) —`,
    bundle.end_clauses.length ? fmt(bundle.end_clauses) : "  (empty)",
    "",
    "— end_state —",
    fmt(bundle.end_state),
    "",
    `— consequences (${bundle.consequences.length}) —`,
    bundle.consequences.length ? fmt(bundle.consequences) : "  (empty)",
    "",
    `— law ↔ thread links (${bundle.law_thread_links.length}) —`,
    bundle.law_thread_links.length
      ? bundle.law_thread_links
          .map((l) => `  law ${l.law_id} → thread ${fmt(l.thread_link)}`)
          .join("\n")
      : "  (none)",
  ];
  return lines.join("\n");
}

export function formatStoryStorageGuide(): string {
  const keyLines = STORY_STATE_KEYS.map(
    (k) => `  ${k.key.padEnd(22)} ${k.role}`
  );
  return [
    "HOW STORIES ARE STORED & USED",
    "",
    "GENERATION (turn 1)",
    "  • Client sends opening instruction (+ WorldSpec dials) as first user msg",
    "  • Model returns [SCENE] + [WORLD] with STATE containing story keys",
    "  • Full raw turn stored in session history + optional share DB row",
    "",
    "ONGOING PLAY",
    "  • Each assistant turn rewrites STATE (plots advance, threads unlock)",
    "  • Client keeps full [WORLD] only on the latest assistant message",
    "  • Older assistant turns sent to LLM as [SCENE] only (WORLD stripped)",
    "  • Latest [WORLD]/STATE is how the model remembers all story state",
    "",
    "STATE KEYS (authoritative story storage)",
    ...keyLines,
    "",
    "PLAYER VISIBILITY",
    "  • [SCENE] never dumps hidden plot truth — character POV only",
    "  • starting_plot / threads may advance off-screen via timeline",
    "  • Ignoring starting_plot is valid (phase may become abandoned)",
  ].join("\n");
}

/** Pull story-related sections from the system prompt for debug. */
export function extractStoryPromptExcerpts(systemPrompt: string): string {
  const markers: [string, RegExp][] = [
    ["STARTING PLOT / THREADS AT GEN", /At the start of every new session[\s\S]*?TIMELINE\. heat from law_pressure baseline\./],
    ["NO RAILROAD", /NO MASSIVE FORCES \/ NO RAILROAD[\s\S]*?not plot magnets\./],
    ["STARTING PLOT PHASES", /STARTING PLOT PHASES[\s\S]*?hijacking SCENE\./],
    ["THREADS AS LAW PROBES", /THREADS AS LAW PROBES[\s\S]*?Ignoring threads is valid\./],
    ["SOFT VS HARD ENDINGS", /SOFT VS HARD ENDINGS[\s\S]*?Never say "MAIN PLOT"\./],
    ["STORY DIVERGENCE", /STORY DIVERGENCE[\s\S]*?Not for routine movement\./],
    ["BRANCHING", /BRANCHING[\s\S]*?Ignoring the starting plot is valid play\./],
    ["TIMELINE / STALL", /Time and TIMELINE advance[\s\S]*?onto the starting plot\./],
  ];

  const chunks: string[] = ["STORY RULES IN SYSTEM PROMPT (excerpts)", ""];
  for (const [title, re] of markers) {
    const m = systemPrompt.match(re);
    chunks.push(`--- ${title} ---`);
    chunks.push(m ? m[0].trim() : "(section not found)");
    chunks.push("");
  }
  return chunks.join("\n").trimEnd();
}
