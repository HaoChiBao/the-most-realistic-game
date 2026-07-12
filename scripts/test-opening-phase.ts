import { buildGameMessages } from "../lib/gameMessages";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const present = buildGameMessages([], "12345678901234", null, null, "present");
assert(present.length === 2, "present: system + user");
assert(
  present[1].content.includes("PHASE A"),
  "present uses phase A instruction"
);

const bootstrapOpening = `[SCENE]
YOU WAKE UP IN A MOTEL ROOM.

[WORLD]
STATE
{"player_location":"motel","clock":{"turn":1}}`;

const hydrate = buildGameMessages(
  [{ role: "assistant", content: bootstrapOpening }],
  null,
  null,
  null,
  "hydrate"
);
assert(hydrate.length === 3, "hydrate: system + assistant + user");
assert(hydrate[1].content.includes("[WORLD]"), "hydrate includes opening world");
assert(
  hydrate[2].content.includes("HYDRATION PASS"),
  "hydrate uses hydration instruction"
);

const normal = buildGameMessages(
  [
    { role: "assistant", content: bootstrapOpening },
    { role: "user", content: "look around" },
  ],
  null,
  null,
  null
);
assert(normal.length >= 3, "normal turn has history");

console.log("gameMessages opening phase tests passed");
