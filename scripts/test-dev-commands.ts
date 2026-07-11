import {
  executeDevCommand,
  formatCommandList,
  isDevCommand,
  parseDevCommandInput,
} from "../lib/devCommands";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(isDevCommand("/story"), "slash detect");
assert(!isDevCommand("look around"), "not slash");
assert(parseDevCommandInput("/npcs guard")?.cmd === "npcs", "parse cmd");
assert(parseDevCommandInput("/npcs guard")?.args === "guard", "parse args");

const list = executeDevCommand("/commands", {
  history: [],
  seedCode: null,
  syncTimings: [],
  worldReady: false,
  ended: false,
  softEnded: false,
  endLabel: null,
});
assert(list.lines.join("\n").includes("/story"), "list includes story");
assert(formatCommandList().some((l) => l.includes("/debug")), "format list");

const session = executeDevCommand("/session", {
  history: [{ role: "user", content: "look" }],
  seedCode: "12345678901234",
  engineVersion: "v5.8",
  syncTimings: [],
  worldReady: true,
  ended: false,
  softEnded: false,
  endLabel: null,
});
assert(session.lines.join("\n").includes("v5.8"), "session shows engine");

const unknown = executeDevCommand("/foobar", {
  history: [],
  seedCode: null,
  syncTimings: [],
  worldReady: true,
  ended: false,
  softEnded: false,
  endLabel: null,
});
assert(unknown.lines.join("\n").includes("UNKNOWN"), "unknown cmd");

assert(list.lines.join("\n").includes("/next"), "list includes next");
assert(
  executeDevCommand("/consequences", {
    history: [],
    seedCode: null,
    syncTimings: [],
    worldReady: false,
    ended: false,
    softEnded: false,
    endLabel: null,
  })
    .lines.join("\n")
    .includes("NOT READY"),
  "consequences maps to next inject"
);

console.log("devCommands tests passed");
