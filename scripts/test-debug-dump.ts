import {
  buildDebugSections,
  extractStateJson,
  formatFullDump,
} from "../lib/debugDump";
import { extractStoriesFromState } from "../lib/storyDebug";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const raw = `[SCENE]
You wake up.
[WORLD]
STATE
{
  "world_type": "grounded",
  "player_location": "flooded_40th",
  "player": { "id": "player", "stats": { "hp": 100 } },
  "characters": [{ "id": "cop", "name": "officer" }],
  "heat": { "level": 12 },
  "starting_plot": {
    "id": "flood_evac",
    "hook": "evacuation countdown on the intercom",
    "phase": "setup",
    "countdown_sec": 3600
  },
  "threads": [
    { "id": "missing_kid", "hook": "a child was last seen near the service elevator", "law_id": "no_red_door" }
  ],
  "active_track": "starting",
  "ambient_hooks": ["distant sirens"],
  "timeline": [{ "at_turn": 3, "beat": "power flickers" }],
  "end_clauses": [{ "id": "drown", "when": "player in flooded zone without exit" }],
  "laws": [{ "id": "no_red_door", "surface": "avoid red door", "thread_link": "missing_kid" }]
}
TIMELINE
- something after json
`;

const state = extractStateJson(raw) as Record<string, unknown>;
assert(state && state.world_type === "grounded", "parse world_type");
assert((state.heat as { level: number }).level === 12, "parse heat");
assert(Array.isArray(state.characters), "parse characters");

const stories = extractStoriesFromState(state);
assert(stories?.threads.length === 1, "extract threads");
assert(stories?.law_thread_links.length === 1, "law thread link");

const sections = buildDebugSections({
  history: [{ role: "assistant", content: raw }],
  meta: {
    seedCode: "48271560391234",
    turnCount: 0,
    assistantTurns: 1,
    ended: false,
    softEnded: false,
    endLabel: null,
    worldReady: true,
  },
  systemPrompt: "SYSTEM PROMPT with STARTING PLOT PHASES\nSTARTING PLOT PHASES\nDo not resolve.\nTHREADS AS LAW PROBES\nIgnoring threads is valid.",
  openingInstruction: "OPEN",
});

assert(sections.some((s) => s.id === "system-prompt"), "has prompt");
assert(sections.some((s) => s.id === "stories-overview"), "has stories overview");
assert(sections.some((s) => s.id === "stories-json"), "has stories json");
assert(sections.some((s) => s.id === "story-storage-guide"), "has storage guide");
assert(sections.some((s) => s.id === "llm-payload"), "has llm payload");
assert(sections.some((s) => s.id === "story-prompt-rules"), "has story prompt rules");
assert(sections.some((s) => s.id === "player"), "has player slice");
assert(sections.some((s) => s.id === "threads"), "has threads slice");
assert(formatFullDump(sections).includes("flood_evac"), "full dump includes starting plot");
assert(formatFullDump(sections).includes("missing_kid"), "full dump includes thread");

console.log("debugDump tests passed");
