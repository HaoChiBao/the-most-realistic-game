import { resolveActionConsequence } from "../lib/actionConsequence";
import { sanitizeSceneMeta, parseScene } from "../lib/sceneParse";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const lethal = resolveActionConsequence([
  { role: "user", content: "attack the officer" },
  {
    role: "assistant",
    content: `[SCENE]\nCuffed.\n[WORLD]\nSTATE\n{"characters":[{"id":"mills","name":"Mills","role":"officer","stats":{"firearms":60}}],"player":{"conditions":[{"kind":"restraint","label":"handcuffed"}]}}`,
  },
  { role: "user", content: "shoot him" },
]);
assert(lethal?.kind === "lethal", "shoot officer triggers lethal");

const authority = resolveActionConsequence([
  { role: "user", content: "look around" },
  {
    role: "assistant",
    content: `[SCENE]\nAn officer watches.\n[WORLD]\nSTATE\n{"characters":[{"id":"mills","name":"Mills","role":"officer","stats":{"firearms":60}}]}`,
  },
  { role: "user", content: "attack the officers" },
]);
assert(authority?.kind === "authority", "first assault triggers authority");

const detention = resolveActionConsequence([
  {
    role: "assistant",
    content: `[SCENE]\nYou are cuffed face down.\n[WORLD]\nSTATE\n{"characters":[{"id":"mills","name":"Mills","role":"officer"}]}`,
  },
  { role: "user", content: "wait 30 minutes" },
  {
    role: "assistant",
    content: `[SCENE]\nStill cuffed.\n[WORLD]\nSTATE\n{"characters":[{"id":"mills","name":"Mills","role":"officer"}]}`,
  },
  { role: "user", content: "keep waiting" },
]);
assert(detention?.kind === "detention", "wait loop triggers detention timer");

const cleaned = parseScene(
  `[SCENE]\nYou struggle.\n[COMBAT ESCALATION — server authoritative]\nmore\n[SCENE continues restrained.]\n[WORLD]\nSTATE\n{}`
);
assert(!cleaned.scene.includes("COMBAT"), "strip combat leak");
assert(!cleaned.scene.includes("continues"), "strip scene meta");
assert(sanitizeSceneMeta("[SCENE continues x]") === "", "sanitize meta only");

console.log("actionConsequence tests passed");
