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
assert(list.lines.join("\n").includes("/health"), "list includes health");
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

const vitalsState = {
  player_location: "locker_room",
  player: {
    id: "player",
    alive: true,
    conscious: true,
    body: {
      head: "ok",
      torso: "bruised",
      left_arm: "ok",
      right_arm: "ok",
      left_leg: "ok",
      right_leg: "ok",
    },
    stats: {
      hp: 72,
      stamina: 55,
      pain: 18,
      combat: 22,
      firearms: 10,
      awareness: 40,
      composure: 45,
      mobility: 90,
    },
    conditions: [],
    traits: [],
    abilities: [],
  },
  characters: [
    {
      id: "guard_1",
      name: "Marcus",
      role: "security guard",
      alive: true,
      conscious: true,
      body: {
        head: "ok",
        torso: "ok",
        left_arm: "ok",
        right_arm: "ok",
        left_leg: "ok",
        right_leg: "ok",
      },
      stats: { hp: 80, stamina: 70, pain: 0, combat: 55 },
    },
  ],
};

const vitalsHistory = [
  {
    role: "assistant" as const,
    content: `[SCENE]
YOU WAKE UP IN A LOCKER ROOM.

[WORLD]
STATE
${JSON.stringify(vitalsState, null, 2)}
`,
  },
];

const healthCtx = {
  history: vitalsHistory,
  seedCode: "12345678901234",
  syncTimings: [],
  worldReady: true,
  ended: false,
  softEnded: false,
  endLabel: null,
};

const health = executeDevCommand("/health", healthCtx);
assert(health.lines.join("\n").includes("hp"), "health shows hp");
assert(health.lines.join("\n").includes("72"), "health shows player hp value");
assert(health.lines.join("\n").includes("torso"), "health shows body part");

const npcHealth = executeDevCommand("/health marcus", healthCtx);
assert(npcHealth.lines.join("\n").includes("Marcus"), "npc health by name");
assert(npcHealth.lines.join("\n").includes("80"), "npc health shows hp");

const traits = executeDevCommand("/traits", healthCtx);
assert(traits.lines.join("\n").includes("VITALS"), "traits leads with vitals");

console.log("devCommands tests passed");
