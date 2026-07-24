import {
  buildDebugSections,
  extractStateJson,
} from "../lib/debugDump";
import {
  extractCharactersFromState,
  formatCharactersOverview,
} from "../lib/characterDebug";
import { SYSTEM_PROMPT } from "../lib/systemPrompt";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const raw = `[SCENE]
A guard steps forward.
[WORLD]
STATE
{
  "world_type": "grounded",
  "clock": {"turn": 4},
  "player_location": "garage_lobby",
  "player": { "id": "player", "stats": { "hp": 60, "combat": 15 } },
  "characters": [{
    "id": "guard_marcus",
    "name": "Marcus",
    "role": "night security guard",
    "archetype": "authority",
    "location": "garage_lobby",
    "appearance": "stocky, fortyish, uniform",
    "personality": ["by-the-book", "alert"],
    "disposition": "hostile",
    "trust_to_player": -60,
    "violence": "fight",
    "combat_posture": "restraining_player",
    "will_fight_back": true,
    "authority_level": "medium",
    "training": "professional",
    "stats": { "combat": 55, "hp": 70 },
    "introduced_turn": 2,
    "last_seen_turn": 4,
    "memory": [
      {"turn": 2, "event": "player tackled me", "emotional_weight": "high"},
      {"turn": 3, "event": "player threw phone", "emotional_weight": "medium"},
      {"turn": 4, "event": "pinned player after sustained assault", "emotional_weight": "high"}
    ]
  }]
}
`;

const state = extractStateJson(raw);
assert(state, "parse state");

const bundle = extractCharactersFromState(state);
assert(bundle?.count === 1, "one character");
assert(bundle?.characters[0].id === "guard_marcus", "guard id");
assert(bundle?.hostile_count === 1, "hostile guard");
assert(bundle?.combat_ready === 1, "combat ready");
assert((bundle?.characters[0].memory?.length ?? 0) === 3, "memory entries");

const overview = formatCharactersOverview(bundle);
assert(overview.includes("Marcus"), "overview names guard");
assert(overview.includes("restraining_player"), "overview shows posture");
assert(overview.includes("pinned player"), "overview shows memory");
assert(overview.includes("hp 70"), "overview shows hp");
assert(overview.includes("combat 55"), "overview shows combat");

const sections = buildDebugSections({
  history: [{ role: "assistant", content: raw }],
  meta: {
    seedCode: "14042509448598",
    turnCount: 4,
    assistantTurns: 1,
    ended: false,
    softEnded: false,
    endLabel: null,
    worldReady: true,
  },
  systemPrompt: SYSTEM_PROMPT,
  openingInstruction: "OPEN",
});

assert(sections.some((s) => s.id === "characters-overview"), "has characters overview");
assert(sections.some((s) => s.id === "characters-json"), "has characters json");
assert(sections.some((s) => s.id === "character-storage-guide"), "has character guide");
assert(sections.some((s) => s.id === "character-prompt-rules"), "has character prompt rules");

console.log("characterDebug tests passed");
