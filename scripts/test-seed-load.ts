import {
  assertSeedEngineCompatible,
  mapSeedLoadResponse,
} from "../lib/seedLoad";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const current = "v6.0";

const ok = assertSeedEngineCompatible("v6.0", current);
assert(ok.ok === true, "matching engine_ver accepted");
if (ok.ok) assert(ok.engineVer === "v6.0", "returns trimmed ver");

const mismatch = assertSeedEngineCompatible("v5.4", current);
assert(mismatch.ok === false, "older engine refused");
if (!mismatch.ok) {
  assert(mismatch.status === 409, "mismatch uses 409");
  assert(
    mismatch.error.includes("v5.4") && mismatch.error.includes("v6.0"),
    "error names both versions"
  );
}

const missing = assertSeedEngineCompatible(null, current);
assert(missing.ok === false, "missing engine_ver refused");
if (!missing.ok) assert(missing.status === 409, "missing uses 409");

const empty = assertSeedEngineCompatible("   ", current);
assert(empty.ok === false, "blank engine_ver refused");

const mapped = mapSeedLoadResponse({
  code: "12345678901234",
  setting: "a ferry",
  opening: "YOU WAKE UP ON A FERRY.",
  world_state: "STATE\n{}",
  play_count: 3,
  engine_ver: "v6.0",
});
assert(mapped.world === "STATE\n{}", "maps world_state → world");
assert(mapped.engineVer === "v6.0", "exposes engineVer to client");
assert(mapped.playCount === 3, "maps play_count");

console.log("seedLoad tests passed");
