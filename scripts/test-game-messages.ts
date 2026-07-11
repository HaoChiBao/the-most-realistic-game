import { buildGameMessages } from "../lib/gameMessages";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const opening = buildGameMessages([], "12345678901234");
const openingUser = opening.find((m) => m.role === "user");
assert(openingUser?.content.includes("Turn 1 ONLY"), "opening asks for full STATE");
assert(
  !openingUser?.content.includes("DELTA ONLY"),
  "opening has no delta reminder"
);

const turn2 = buildGameMessages(
  [
    {
      role: "assistant",
      content: `[SCENE]\nWake.\n[WORLD]\nSTATE\n{"clock":{"turn":1},"player_location":"room"}`,
    },
    { role: "user", content: "look around" },
  ],
  "12345678901234"
);
const lastUser = turn2.filter((m) => m.role === "user").pop();
assert(lastUser?.content.includes("DELTA ONLY"), "turn 2 injects delta reminder");
assert(lastUser?.content.includes("look around"), "user action preserved");

const withCombat = buildGameMessages(
  [
    {
      role: "assistant",
      content: `[SCENE]\nGuard.\n[WORLD]\nSTATE\n{"characters":[{"id":"g","role":"guard"}]}`,
    },
    { role: "user", content: "punch him" },
  ],
  null,
  null,
  {
    kind: "authority",
    fired: true,
    prompt_block: "[AUTHORITY RESPONSE]",
  }
);
const combatUser = withCombat.filter((m) => m.role === "user").pop();
assert(combatUser?.content.includes("[AUTHORITY RESPONSE]"), "consequence injected");
assert(combatUser?.content.includes("DELTA ONLY"), "delta with consequence");

console.log("gameMessages tests passed");
