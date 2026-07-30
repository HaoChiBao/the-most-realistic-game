import {
  playerRestrained,
  resolveActionConsequence,
} from "../lib/actionConsequence";
import { sanitizeSceneMeta, parseScene } from "../lib/sceneParse";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const lethal = resolveActionConsequence([
  { role: "user", content: "attack the officer" },
  {
    role: "assistant",
    content: `[SCENE]\nCuffed.\n[WORLD]\nSTATE\n{"player_location":"alley","characters":[{"id":"mills","name":"Mills","role":"officer","location":"alley","stats":{"firearms":60}}],"player":{"conditions":[{"kind":"restraint","label":"handcuffed"}]}}`,
  },
  { role: "user", content: "shoot him" },
]);
assert(lethal?.kind === "lethal", "shoot officer triggers lethal");

const authority = resolveActionConsequence([
  { role: "user", content: "look around" },
  {
    role: "assistant",
    content: `[SCENE]\nAn officer watches.\n[WORLD]\nSTATE\n{"player_location":"street","characters":[{"id":"mills","name":"Mills","role":"officer","location":"street","stats":{"firearms":60}}]}`,
  },
  { role: "user", content: "attack the officers" },
]);
assert(authority?.kind === "authority", "first assault triggers authority");

const detention = resolveActionConsequence([
  {
    role: "assistant",
    content: `[SCENE]\nYou are cuffed face down.\n[WORLD]\nSTATE\n{"player_location":"street","characters":[{"id":"mills","name":"Mills","role":"officer","location":"street"}]}`,
  },
  { role: "user", content: "wait 30 minutes" },
  {
    role: "assistant",
    content: `[SCENE]\nStill cuffed.\n[WORLD]\nSTATE\n{"player_location":"street","characters":[{"id":"mills","name":"Mills","role":"officer","location":"street"}]}`,
  },
  { role: "user", content: "keep waiting" },
]);
assert(detention?.kind === "detention", "wait loop triggers detention timer");

// --- 0.1 restraint false positives ---
const traumaState = {
  player: {
    conditions: [
      {
        kind: "trauma",
        label: "broken leg",
        progress: "active",
        gates: ["sprint"],
      },
    ],
  },
};
assert(
  !playerRestrained(traumaState, "You limp. Leg hurts."),
  "trauma + sprint gate is not detention restraint"
);

const realRestraint = {
  player: {
    conditions: [
      { kind: "restraint", label: "handcuffed", progress: "active" },
    ],
  },
};
assert(playerRestrained(realRestraint, null), "kind=restraint counts");

const traumaWait = resolveActionConsequence([
  {
    role: "assistant",
    content: `[SCENE]\nYou limp after the fall.\n[WORLD]\nSTATE\n{"player_location":"lot","player":{"conditions":[{"kind":"trauma","label":"broken leg","progress":"active","gates":["sprint"]}]},"characters":[{"id":"mills","name":"Mills","role":"officer","location":"lot"}]}`,
  },
  { role: "user", content: "wait" },
  {
    role: "assistant",
    content: `[SCENE]\nStill hurting.\n[WORLD]\nSTATE\n{"player_location":"lot","player":{"conditions":[{"kind":"trauma","label":"broken leg","progress":"active","gates":["sprint"]}]},"characters":[{"id":"mills","name":"Mills","role":"officer","location":"lot"}]}`,
  },
  { role: "user", content: "keep waiting" },
]);
assert(
  traumaWait?.kind !== "detention",
  "wait spam with broken leg must not inject detention"
);

const restraintWait = resolveActionConsequence([
  {
    role: "assistant",
    content: `[SCENE]\nYou wait.\n[WORLD]\nSTATE\n{"player_location":"lot","player":{"conditions":[{"kind":"restraint","label":"handcuffed","progress":"active"}]},"characters":[{"id":"mills","name":"Mills","role":"officer","location":"lot"}]}`,
  },
  { role: "user", content: "wait" },
  {
    role: "assistant",
    content: `[SCENE]\nStill held.\n[WORLD]\nSTATE\n{"player_location":"lot","player":{"conditions":[{"kind":"restraint","label":"handcuffed","progress":"active"}]},"characters":[{"id":"mills","name":"Mills","role":"officer","location":"lot"}]}`,
  },
  { role: "user", content: "keep waiting" },
]);
assert(
  restraintWait?.kind === "detention",
  "real restraint + wait ×2 → detention"
);

// --- 0.2 lethal targeting ---
const civilianGunGrab = resolveActionConsequence([
  {
    role: "assistant",
    content: `[SCENE]\nA nervous civilian holds a revolver.\n[WORLD]\nSTATE\n{"player_location":"bar","characters":[{"id":"dave","name":"Dave","role":"civilian","archetype":"civilian","location":"bar","authority_level":"none","stats":{"combat":20}}]}`,
  },
  { role: "user", content: "grab his gun" },
]);
assert(
  civilianGunGrab?.kind !== "lethal",
  "civilian gun grab must not emit SHOT BY POLICE"
);

const officerSameRoom = resolveActionConsequence([
  {
    role: "assistant",
    content: `[SCENE]\nOfficer Mills keeps a hand near his holster.\n[WORLD]\nSTATE\n{"player_location":"bar","characters":[{"id":"mills","name":"Mills","role":"officer","location":"bar","archetype":"authority","authority_level":"high","stats":{"firearms":70}}]}`,
  },
  { role: "user", content: "grab his gun" },
]);
assert(
  officerSameRoom?.kind === "lethal",
  "gun grab with officer in same location → lethal"
);
assert(
  officerSameRoom?.prompt_block.includes("Mills"),
  "lethal names the present officer"
);

const officerElsewhere = resolveActionConsequence([
  {
    role: "assistant",
    content: `[SCENE]\nA bartender wipes glasses. No cops in sight.\n[WORLD]\nSTATE\n{"player_location":"bar","characters":[{"id":"dave","name":"Dave","role":"bartender","location":"bar","archetype":"civilian","authority_level":"none"},{"id":"mills","name":"Mills","role":"officer","location":"precinct","archetype":"authority","authority_level":"high","stats":{"firearms":70}}]}`,
  },
  { role: "user", content: "grab his gun" },
]);
assert(
  officerElsewhere?.kind !== "lethal",
  "officer elsewhere in registry must not false-police ending"
);

const cleaned = parseScene(
  `[SCENE]\nYou struggle.\n[COMBAT ESCALATION — server authoritative]\nmore\n[SCENE continues restrained.]\n[WORLD]\nSTATE\n{}`
);
assert(!cleaned.scene.includes("COMBAT"), "strip combat leak");
assert(!cleaned.scene.includes("continues"), "strip scene meta");
assert(sanitizeSceneMeta("[SCENE continues x]") === "", "sanitize meta only");

console.log("actionConsequence tests passed");
