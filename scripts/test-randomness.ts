import { computeHybridRoll, seededRoll, tagPlayerAction } from "../lib/randomness";
import { resolveRollForHistory } from "../lib/rollContext";
import { decodeSeed } from "../lib/worldSpec";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(seededRoll("48271560391234", 5, "fire") === seededRoll("48271560391234", 5, "fire"), "seeded deterministic");
assert(tagPlayerAction("sprint across the dock").includes("run"), "tags run");
assert(tagPlayerAction("look around the stream").includes("discovery"), "tags discovery");

const spec = decodeSeed("48271560391234");
const roll = computeHybridRoll({
  seedCode: "48271560391234",
  turn: 3,
  playerAction: "sprint across the wet dock",
  spec,
  state: {
    player: { stats: { composure: 30 }, inventory: [{ name: "pistol" }] },
    randomness: { chaos: 5, cooldown_turns: 0 },
    noticed_before: ["rust_red_paint"],
  },
});

assert(roll.action_tags.includes("run"), "roll tags");
assert(roll.prompt_block.includes("RANDOMNESS"), "prompt block");

const fromHistory = resolveRollForHistory(
  [
    { role: "assistant", content: "[SCENE]\nhi\n[WORLD]\nSTATE\n{\"clock\":{\"turn\":2}}" },
    { role: "user", content: "run" },
  ],
  "48271560391234"
);
assert(fromHistory !== null, "resolve from history");

console.log("randomness tests passed");
