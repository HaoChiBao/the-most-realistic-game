import { resolveCombatEscalation } from "../lib/combatContext";
import { pickCombatNpc, pickAuthorityNpc } from "../lib/npcSelect";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const history = [
  { role: "user" as const, content: "run up and tackle him" },
  {
    role: "assistant" as const,
    content: `[SCENE]
You tackle the guard. He blocks some but looks ready to respond.
[WORLD]
STATE
{"player_location":"garage","player":{"stats":{"combat":18}},"characters":[{"id":"guard_1","name":"Vince","role":"security guard","location":"garage","training":"professional","stats":{"combat":58},"disposition":"hostile","combat_posture":"defensive","will_fight_back":true}]}`,
  },
  { role: "user" as const, content: "start boxing him" },
  {
    role: "assistant" as const,
    content: `[SCENE]
You throw punches. He blocks some but prepares to push back.
[WORLD]
STATE
{"player_location":"garage","player":{"stats":{"combat":18}},"characters":[{"id":"guard_1","name":"Vince","role":"security guard","location":"garage","training":"professional","stats":{"combat":58},"disposition":"hostile","combat_posture":"defensive"}]}`,
  },
  { role: "user" as const, content: "keep throwing punches" },
];

const combat = resolveCombatEscalation(history, { seedCode: "1212121212" });
assert(combat?.fired, "combat escalation should fire after passive loop");
assert(combat!.attack_streak >= 2, "attack streak counted");
assert(combat!.passive_last_scene, "detected passive scene");
assert(combat!.outcome, "structured outcome present");
assert(combat!.prompt_block.includes("COMBAT OUTCOME"), "has outcome header");
assert(combat!.prompt_block.includes("Vince"), "names target npc");
assert(
  combat!.prompt_block.includes("Forbidden stalls"),
  "lists banned passive phrases"
);
assert(
  combat!.prompt_block.includes("No plot nudges"),
  "blocks plot nudges"
);

const chill = resolveCombatEscalation([
  { role: "user", content: "look around" },
  {
    role: "assistant",
    content: `[SCENE]\nYou look around.\n[WORLD]\nSTATE\n{"characters":[]}`,
  },
  { role: "user", content: "walk north" },
]);
assert(chill === null, "no escalation on chill play");

// --- 0.3 location-scoped combat targets ---
const twoRoomState = {
  player_location: "alley",
  characters: [
    {
      id: "thug",
      name: "Rico",
      role: "thug",
      location: "alley",
      disposition: "hostile",
      combat_posture: "aggressive",
      training: "basic",
      stats: { combat: 35 },
    },
    {
      id: "swat",
      name: "Commander Vale",
      role: "officer",
      location: "precinct",
      disposition: "hostile",
      combat_posture: "alert",
      training: "elite",
      stats: { combat: 95, firearms: 90 },
    },
  ],
};

const localTarget = pickCombatNpc(twoRoomState, {
  scene: "Rico swings at you in the alley.",
  allowGlobalFallback: true,
});
assert(localTarget?.id === "thug", "wrong-room high-combat NPC ignored");
assert(localTarget?.name === "Rico", "picks co-located fighter");

const farAuthority = pickAuthorityNpc(twoRoomState, {
  scene: "Rico swings at you in the alley.",
  allowGlobalFallback: false,
});
assert(
  farAuthority === null,
  "authority in other room ignored without global fallback"
);

const wrongRoomEscalation = resolveCombatEscalation([
  { role: "user", content: "punch rico" },
  {
    role: "assistant",
    content: `[SCENE]
Rico blocks some but looks ready to respond.
[WORLD]
STATE
${JSON.stringify({
  player_location: "alley",
  player: { stats: { combat: 20 } },
  characters: twoRoomState.characters,
})}`,
  },
  { role: "user", content: "punch him again" },
]);
assert(wrongRoomEscalation?.fired, "escalation still fires vs local foe");
assert(
  wrongRoomEscalation?.target_npc_id === "thug",
  "escalation targets alley thug, not precinct SWAT"
);
assert(
  !wrongRoomEscalation?.prompt_block.includes("Commander Vale"),
  "must not name wrong-room NPC"
);

console.log("combatContext tests passed");
