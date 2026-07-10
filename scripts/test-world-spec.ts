import {
  clampTone,
  decodeSeed,
  formatWorldSpecForPrompt,
} from "../lib/worldSpec";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const spec = decodeSeed("4827156039");
assert(spec, "decode valid code");
assert(spec!.world_type === "heightened", "D1 band heightened");
assert(spec!.place_grain === 8, "D2");
assert(spec!.law_count >= 1, "law count");
assert(spec!.constraints.length > 0, "constraints");
assert(spec!.crossed_pressures.length > 0, "crossed");

const grounded = decodeSeed("1999999999");
assert(grounded!.world_type === "grounded", "low D1 grounded");
assert(grounded!.tone <= 4, "tone clamped for grounded");
assert(clampTone(9, "grounded") === 4, "clampTone grounded");
assert(clampTone(9, "fantastical") === 9, "clampTone fantastical");

const bad = decodeSeed("abc");
assert(bad === null, "reject non-numeric");

const block = formatWorldSpecForPrompt(spec!);
assert(block.includes("WORLDSPEC"), "prompt block");
assert(block.includes(spec!.code), "includes code");
assert(!block.toLowerCase().includes("murder mystery"), "no plot genre");

console.log("worldSpec tests passed");
