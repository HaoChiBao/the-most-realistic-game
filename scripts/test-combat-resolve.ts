import {
  pickWeightedOutcome,
  resolveCombatOutcome,
  tagCombatAction,
  type CombatOutcome,
} from "../lib/combatResolve";
import { resolveCombatEscalation } from "../lib/combatContext";
import { resolveActionConsequence } from "../lib/actionConsequence";
import { seededRoll } from "../lib/randomness";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// --- tags ---
assert(tagCombatAction("punch him").includes("attack"), "punch → attack");
assert(tagCombatAction("flee the alley").includes("flee"), "flee tagged");
assert(
  tagCombatAction("grab his gun").includes("lethal_rash"),
  "gun grab → lethal_rash"
);

// --- weighted pick deterministic ---
assert(
  pickWeightedOutcome({ npc_restrains: 100 }, 42) === "npc_restrains",
  "single weight wins"
);
assert(
  pickWeightedOutcome({}, 10) === "stalemate_costly",
  "empty weights → stalemate"
);

// --- flee escapes envelope ---
const flee = resolveCombatOutcome({
  action: "flee down the alley",
  playerCombat: 15,
  npc: {
    id: "mills",
    name: "Mills",
    role: "officer",
    combat: 70,
    firearms: 80,
    training: "professional",
    archetype: "authority",
    authority_level: "high",
  },
  isAuthority: true,
  attackStreak: 2,
  seedCode: "1234567890",
  turn: 4,
});
assert(flee.outcome === "player_flees", "flee → player_flees vs pro authority");
assert(flee.prompt_block.includes("player_flees"), "prompt names outcome");
assert(
  flee.prompt_block.includes("NOT cuffed this turn"),
  "flee forbids cuff outcome"
);

// --- untrained vs professional authority → restrain/lethal distribution ---
const authorityNpc = {
  id: "mills",
  name: "Mills",
  role: "officer",
  combat: 65,
  firearms: 70,
  training: "professional",
  archetype: "authority",
  authority_level: "high",
} as const;

const outcomes = new Set<CombatOutcome>();
for (let turn = 1; turn <= 40; turn++) {
  const r = resolveCombatOutcome({
    action: "keep punching him",
    tags: ["attack"],
    playerCombat: 18,
    npc: authorityNpc,
    isAuthority: true,
    attackStreak: 2,
    heatLevel: 40,
    seedCode: "5555555555",
    turn,
  });
  outcomes.add(r.outcome);
}
assert(
  outcomes.has("npc_restrains") || outcomes.has("npc_lethal") || outcomes.has("npc_ko"),
  "untrained vs pro authority yields NPC finish outcomes"
);
assert(
  !outcomes.has("player_flees"),
  "attack action must not resolve as flee"
);
// Across many seeds/turns, restrain should dominate for streak=2.
let restrain = 0;
let lethal = 0;
let other = 0;
for (let turn = 1; turn <= 100; turn++) {
  const r = resolveCombatOutcome({
    action: "punch the officer",
    tags: ["attack"],
    playerCombat: 12,
    npc: authorityNpc,
    isAuthority: true,
    attackStreak: 2,
    heatLevel: 20,
    seedCode: "9999999999",
    turn,
  });
  if (r.outcome === "npc_restrains") restrain++;
  else if (r.outcome === "npc_lethal") lethal++;
  else other++;
}
assert(restrain > lethal, "restrain more common than lethal at streak=2");
assert(restrain + lethal + other === 100, "counted all rolls");
assert(
  restrain >= 40,
  `restrain should be common for untrained vs pro (got ${restrain})`
);

// Same seed+turn → same outcome
const a = resolveCombatOutcome({
  action: "tackle him",
  playerCombat: 20,
  npc: authorityNpc,
  isAuthority: true,
  attackStreak: 3,
  seedCode: "1111111111",
  turn: 7,
});
const b = resolveCombatOutcome({
  action: "tackle him",
  playerCombat: 20,
  npc: authorityNpc,
  isAuthority: true,
  attackStreak: 3,
  seedCode: "1111111111",
  turn: 7,
});
assert(a.outcome === b.outcome && a.roll === b.roll, "seeded combat is stable");
assert(
  a.roll === seededRoll("1111111111", 7, "combat:mills:3"),
  "uses combat salt"
);

// Lethal rash vs armed authority
const lethalRash = resolveCombatOutcome({
  action: "grab his gun",
  playerCombat: 20,
  npc: authorityNpc,
  isAuthority: true,
  attackStreak: 1,
  seedCode: "2222222222",
  turn: 2,
});
assert(lethalRash.outcome === "npc_lethal", "gun grab → npc_lethal");
assert(lethalRash.end_label === "SHOT BY POLICE", "lethal end label");

// Strong player can wound weaker civilian
const wound = resolveCombatOutcome({
  action: "punch him hard",
  tags: ["attack"],
  playerCombat: 80,
  npc: {
    id: "dave",
    name: "Dave",
    role: "civilian",
    combat: 20,
    firearms: 5,
    training: "none",
    archetype: "civilian",
    authority_level: "none",
  },
  isAuthority: false,
  attackStreak: 1,
  seedCode: "3333333333",
  turn: 1,
});
assert(
  wound.outcome !== "npc_lethal",
  "civilian fight must not be npc_lethal"
);
assert(
  [
    "player_wounds_npc",
    "stalemate_costly",
    "npc_ko",
    "npc_restrains",
  ].includes(wound.outcome),
  "strong player vs weak civilian stays in non-lethal outcomes"
);

// --- wire-through: combat escalation uses outcome envelope ---
const history = [
  { role: "user" as const, content: "run up and tackle him" },
  {
    role: "assistant" as const,
    content: `[SCENE]
You tackle the guard. He blocks some but looks ready to respond.
[WORLD]
STATE
{"clock":{"turn":3},"player_location":"garage","player":{"stats":{"combat":18}},"characters":[{"id":"guard_1","name":"Vince","role":"security guard","location":"garage","training":"professional","stats":{"combat":58,"firearms":45},"disposition":"hostile","combat_posture":"defensive","archetype":"authority","authority_level":"medium"}],"heat":{"level":30}}`,
  },
  { role: "user" as const, content: "keep throwing punches" },
];

const combat = resolveCombatEscalation(history, { seedCode: "4444444444" });
assert(combat?.fired, "escalation fires");
assert(combat!.outcome, "escalation carries outcome");
assert(
  combat!.prompt_block.includes("COMBAT OUTCOME"),
  "uses structured outcome block"
);
assert(
  !combat!.prompt_block.includes("NPC MUST win"),
  "open-ended MUST win prose removed"
);
assert(
  combat!.prompt_block.includes("Allowed SCENE verbs"),
  "lists allowed verbs"
);

const viaConsequence = resolveActionConsequence(history, {
  seedCode: "4444444444",
});
assert(viaConsequence?.kind === "combat", "actionConsequence → combat");
assert(
  viaConsequence?.debug?.outcome === combat!.outcome,
  "debug exposes outcome"
);

// Flee mid-fight through escalation
const fleeHistory = [
  { role: "user" as const, content: "punch the guard" },
  {
    role: "assistant" as const,
    content: `[SCENE]
You clip his jaw. He looks ready to respond.
[WORLD]
STATE
{"clock":{"turn":5},"player_location":"garage","player":{"stats":{"combat":18}},"characters":[{"id":"guard_1","name":"Vince","role":"security guard","location":"garage","training":"professional","stats":{"combat":58},"disposition":"hostile","combat_posture":"aggressive"}]}`,
  },
  { role: "user" as const, content: "flee out the side door" },
];
const fleeEscalation = resolveCombatEscalation(fleeHistory, {
  seedCode: "6666666666",
});
assert(fleeEscalation?.fired, "flee mid-fight still fires envelope");
assert(
  fleeEscalation?.outcome === "player_flees",
  "flee mid-fight → player_flees"
);

console.log("combatResolve tests passed");
