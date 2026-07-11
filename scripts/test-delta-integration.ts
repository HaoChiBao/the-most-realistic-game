import { resolveActionConsequence } from "../lib/actionConsequence";
import { resolveCanonicalAssistantContent } from "../lib/stateMerge";
import { extractStateJson } from "../lib/stateParse";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const fullOpen = `[SCENE]\nOfficer Mills watches.\n[WORLD]\nSTATE\n${JSON.stringify({
  clock: { turn: 1 },
  characters: [
    {
      id: "mills",
      name: "Mills",
      role: "officer",
      stats: { firearms: 60, combat: 55 },
    },
  ],
  player: { conditions: [] },
})}`;

const history = [{ role: "assistant" as const, content: fullOpen }];
const deltaRaw = `[SCENE]\nYou lunge.\n[WORLD]\nSTATE\n${JSON.stringify({
  clock: { turn: 2 },
  characters: [{ id: "mills", disposition: "hostile", combat_posture: "aggressive" }],
  player: {
    conditions: [{ id: "cuff", kind: "restraint", label: "handcuffed" }],
  },
})}`;

const canonical = resolveCanonicalAssistantContent(history, deltaRaw);
const mergedHistory = [...history, { role: "assistant" as const, content: canonical }];
const state = extractStateJson(canonical) as Record<string, unknown>;
const mills = (state.characters as Record<string, unknown>[])[0];
assert(mills.name === "Mills", "merge keeps npc name from prior turn");
assert(mills.disposition === "hostile", "merge applies disposition patch");
assert(
  ((state.player as Record<string, unknown>).conditions as unknown[]).length === 1,
  "merge applies player condition"
);

const authority = resolveActionConsequence([
  ...history,
  { role: "user", content: "attack the officer" },
  { role: "assistant", content: canonical },
  { role: "user", content: "punch him again" },
]);
assert(authority?.kind === "combat" || authority?.kind === "authority", "merged state works for consequences");

console.log("delta integration tests passed");
