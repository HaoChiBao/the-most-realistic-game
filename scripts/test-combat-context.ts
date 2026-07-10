import { resolveCombatEscalation } from "../lib/combatContext";

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
{"player":{"stats":{"combat":18}},"characters":[{"id":"guard_1","name":"Vince","role":"security guard","training":"professional","stats":{"combat":58},"disposition":"hostile","combat_posture":"defensive","will_fight_back":true}]}`,
  },
  { role: "user" as const, content: "start boxing him" },
  {
    role: "assistant" as const,
    content: `[SCENE]
You throw punches. He blocks some but prepares to push back.
[WORLD]
STATE
{"player":{"stats":{"combat":18}},"characters":[{"id":"guard_1","name":"Vince","role":"security guard","training":"professional","stats":{"combat":58},"disposition":"hostile","combat_posture":"defensive"}]}`,
  },
  { role: "user" as const, content: "keep throwing punches" },
];

const combat = resolveCombatEscalation(history);
assert(combat?.fired, "combat escalation should fire after passive loop");
assert(combat!.attack_streak >= 2, "attack streak counted");
assert(combat!.passive_last_scene, "detected passive scene");
assert(combat!.prompt_block.includes("COMBAT ESCALATION"), "has block header");
assert(combat!.prompt_block.includes("Vince"), "names target npc");
assert(combat!.prompt_block.includes("BANNED"), "lists banned passive phrases");
assert(combat!.prompt_block.includes("ZERO plot nudges"), "blocks plot nudges");

const chill = resolveCombatEscalation([
  { role: "user", content: "look around" },
  {
    role: "assistant",
    content: `[SCENE]\nYou look around.\n[WORLD]\nSTATE\n{"characters":[]}`,
  },
  { role: "user", content: "walk north" },
]);
assert(chill === null, "no escalation on chill play");

console.log("combatContext tests passed");
