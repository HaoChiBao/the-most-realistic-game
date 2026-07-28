import { buildPlayerTimeline } from "../lib/playerTimeline";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const history = [
  {
    role: "user" as const,
    content:
      "Begin a new session (engine v6.0). PHASE A — PRESENT ONLY. Default grounded.",
  },
  {
    role: "assistant" as const,
    content: `[SCENE]
YOU WAKE UP IN A PARKING GARAGE.
[WORLD]
STATE
{"clock":{"turn":1,"time_of_day":"night"},"player_location":"garage_lobby","characters":[],"timeline":[{"at_turn":5,"beat":"backup floods the garage"}],"chronicle":[{"turn":1,"kind":"session","label":"Woke in a parking garage"}],"random_log":[],"consequences":[],"heat":{"level":0,"response":"none"}}`,
  },
  {
    role: "user" as const,
    content:
      "HYDRATION PASS (engine v6.0). The opening [SCENE] label and bootstrap STATE above are FIXED.",
  },
  {
    role: "assistant" as const,
    content: `[WORLD]
STATE
{"characters":[{"id":"guard_marcus","name":"Marcus","role":"night security","known_to_player":true,"introduced_turn":2,"memory":[{"turn":2,"event":"noticed the player staring","emotional_weight":"low"}]}],"chronicle":[{"turn":2,"kind":"intro","label":"Met Marcus the night guard"}],"timeline":[{"at_turn":5,"beat":"backup floods the garage"}],"clock":{"turn":1,"time_of_day":"night"},"player_location":"garage_lobby"}`,
  },
  {
    role: "user" as const,
    content: "look around",
  },
  {
    role: "assistant" as const,
    content: `[SCENE]
Fluorescent lights buzz. A guard watches from the booth.
[WORLD]
STATE
{"clock":{"turn":2,"time_of_day":"night"},"player_location":"garage_lobby","characters":[{"id":"guard_marcus","name":"Marcus","role":"night security","known_to_player":true,"introduced_turn":2,"memory":[{"turn":2,"event":"noticed the player staring","emotional_weight":"low"}]}],"chronicle":[{"turn":2,"kind":"intro","label":"Met Marcus the night guard"}],"timeline":[{"at_turn":5,"beat":"backup floods the garage"}],"random_log":[{"turn":2,"event":"lights flicker once","tier":"minor"}],"consequences":[{"id":"watched_by_guard","label":"under watch","turn":2}],"heat":{"level":10,"response":"none"}}`,
  },
  {
    role: "user" as const,
    content: "punch the guard",
  },
  {
    role: "assistant" as const,
    content: `[SCENE]
You swing. He catches your wrist.
<ENDLABEL>DETAINED BY SECURITY</ENDLABEL><SOFT_END>
[WORLD]
STATE
{"clock":{"turn":3,"time_of_day":"night"},"player_location":"security_booth","characters":[{"id":"guard_marcus","name":"Marcus","role":"night security","known_to_player":true,"introduced_turn":2,"memory":[{"turn":2,"event":"noticed the player staring","emotional_weight":"low"},{"turn":3,"event":"player punched me","emotional_weight":"high"}]}],"chronicle":[{"turn":2,"kind":"intro","label":"Met Marcus the night guard"},{"turn":3,"kind":"action","label":"Tried to punch Marcus"}],"timeline":[{"at_turn":3,"beat":"Marcus calls for backup"},{"at_turn":5,"beat":"backup floods the garage"}],"random_log":[{"turn":2,"event":"lights flicker once","tier":"minor"}],"consequences":[{"id":"watched_by_guard","label":"under watch","turn":2},{"id":"assault","label":"assaulted security","turn":3}],"heat":{"level":40,"response":"backup_en_route"}}`,
  },
];

const tl = buildPlayerTimeline(history);

assert(tl.currentTurn === 3, `current turn 3, got ${tl.currentTurn}`);
assert(tl.location === "security_booth", "location from latest state");
assert(
  tl.events.some((e) => e.kind === "session"),
  "session start"
);
assert(
  tl.events.some((e) => e.kind === "action" && e.label.includes("look around")),
  "player action look around"
);
assert(
  tl.events.some((e) => e.kind === "action" && e.label.includes("punch")),
  "player action punch"
);
assert(
  tl.events.some((e) => e.kind === "intro" && e.label.includes("Marcus")),
  "character intro"
);
assert(
  tl.events.some((e) => e.kind === "memory" && /punched/i.test(e.label)),
  "npc memory"
);
assert(
  tl.events.some((e) => e.kind === "random" && /flicker/i.test(e.label)),
  "random log"
);
assert(
  tl.events.some((e) => e.kind === "beat" && /Marcus calls/i.test(e.label)),
  "past timeline beat"
);
assert(
  !tl.events.some((e) => /backup floods/i.test(e.label)),
  "future timeline beat must be hidden"
);
assert(
  tl.events.some((e) => e.kind === "consequence" && /assault/i.test(e.label)),
  "consequence"
);
assert(
  tl.events.some((e) => e.kind === "heat" && /backup/i.test(e.label)),
  "heat response"
);
assert(
  tl.events.some((e) => e.kind === "end" && /DETAINED/i.test(e.label)),
  "soft end"
);
assert(
  tl.events.some((e) => e.kind === "location" && /security booth/i.test(e.label)),
  "location change"
);

// Chronological
for (let i = 1; i < tl.events.length; i++) {
  assert(
    tl.events[i].turn >= tl.events[i - 1].turn,
    `sorted at ${i}: ${tl.events[i - 1].turn} -> ${tl.events[i].turn}`
  );
}

console.log("test-player-timeline: ok", tl.events.length, "events");
