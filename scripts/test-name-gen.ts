import assert from "node:assert/strict";
import {
  buildNamePoolPromptBlock,
  generateNamePool,
  generatePersonName,
  isPlaceholderName,
  repairCharacterNames,
} from "../lib/nameGen";
import { buildGameMessages } from "../lib/gameMessages";

const seed = "12345678901234";

// Deterministic for same seed+salt
{
  const a = generatePersonName(seed, "pool|0");
  const b = generatePersonName(seed, "pool|0");
  assert.equal(a.full, b.full, "same seed+salt → same name");
  assert.notEqual(
    generatePersonName(seed, "pool|0").full,
    generatePersonName("99999999999999", "pool|0").full,
    "different seed → different name"
  );
}

// Pool uniqueness
{
  const pool = generateNamePool(seed, 8);
  assert.equal(pool.length, 8);
  const keys = new Set(pool.map((n) => n.full.toLowerCase()));
  assert.equal(keys.size, 8, "no duplicate full names in pool");
  for (const n of pool) {
    assert.equal(isPlaceholderName(n.full), false, `pool name ok: ${n.full}`);
  }
}

// Placeholder detection
assert.equal(isPlaceholderName("Jane Doe"), true);
assert.equal(isPlaceholderName("John Smith"), true);
assert.equal(isPlaceholderName("john doe"), true);
assert.equal(isPlaceholderName("NPC 1"), true);
assert.equal(isPlaceholderName("officer"), true);
assert.equal(isPlaceholderName("Renata Voss"), false);
assert.equal(isPlaceholderName("Malik Okonkwo"), false);

// Repair replaces Jane Doe
{
  const { state, replaced } = repairCharacterNames(
    {
      characters: [
        { id: "a", name: "Jane Doe", role: "superintendent" },
        { id: "b", name: "Malik Okonkwo", role: "guard" },
        { id: "c", name: "John Smith" },
      ],
    },
    seed
  );
  const chars = state.characters as { id: string; name: string }[];
  assert.equal(replaced.length, 2);
  assert.equal(chars.find((c) => c.id === "b")?.name, "Malik Okonkwo");
  const a = chars.find((c) => c.id === "a")!;
  const c = chars.find((c) => c.id === "c")!;
  assert.equal(isPlaceholderName(a.name), false);
  assert.equal(isPlaceholderName(c.name), false);
  assert.notEqual(a.name, c.name);
}

// Prompt block
{
  const block = buildNamePoolPromptBlock(seed, 4);
  assert.ok(block.includes("[NAME POOL"));
  assert.ok(block.includes("Jane Doe") === false || block.includes("never"));
  assert.ok(/\d+\. \S+/.test(block));
}

// Hydrate messages include name pool
{
  const msgs = buildGameMessages(
    [
      {
        role: "assistant",
        content: `[SCENE]\nYOU WAKE UP IN A ROOM.\n[WORLD]\nSTATE\n{"clock":{"turn":1},"player_location":"room"}`,
      },
    ],
    seed,
    null,
    null,
    "hydrate"
  );
  const user = msgs.filter((m) => m.role === "user").pop();
  assert.ok(user?.content.includes("[NAME POOL"), "hydrate injects name pool");
  assert.ok(user?.content.includes("HYDRATION PASS"));
}

// Play turn spare names
{
  const msgs = buildGameMessages(
    [
      {
        role: "assistant",
        content: `[SCENE]\nHi.\n[WORLD]\nSTATE\n${JSON.stringify({
          clock: { turn: 1 },
          player_location: "room",
          characters: [{ id: "x", name: "Vera Shaw", location: "room" }],
        })}`,
      },
      { role: "user", content: "open the door" },
    ],
    seed
  );
  const lastUser = msgs.filter((m) => m.role === "user").pop();
  assert.ok(
    lastUser?.content.includes("[NAME POOL — spare"),
    "spare names on play turns"
  );
}

console.log("nameGen tests passed");
