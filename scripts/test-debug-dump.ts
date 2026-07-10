import {
  buildDebugSections,
  extractStateJson,
  formatFullDump,
} from "../lib/debugDump";

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
  "heat": { "level": 12 }
}
TIMELINE
- something after json
`;

const state = extractStateJson(raw) as Record<string, unknown>;
assert(state && state.world_type === "grounded", "parse world_type");
assert((state.heat as { level: number }).level === 12, "parse heat");
assert(Array.isArray(state.characters), "parse characters");

const sections = buildDebugSections({
  history: [{ role: "assistant", content: raw }],
  meta: {
    seedCode: null,
    turnCount: 0,
    assistantTurns: 1,
    ended: false,
    softEnded: false,
    endLabel: null,
    worldReady: true,
  },
  systemPrompt: "SYSTEM",
  openingInstruction: "OPEN",
});

assert(sections.some((s) => s.id === "system-prompt"), "has prompt");
assert(sections.some((s) => s.id === "player"), "has player slice");
assert(sections.some((s) => s.id === "characters"), "has characters slice");
assert(formatFullDump(sections).includes("SYSTEM"), "full dump includes prompt");

console.log("debugDump tests passed");
