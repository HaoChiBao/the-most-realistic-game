import {
  clampTone,
  decodeSeed,
  formatDialTableForDebug,
  formatWorldSpecForPrompt,
  parseSeedCode,
} from "../lib/worldSpec";
import { isValidCode, makeSeedCode } from "../lib/seed";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const spec = decodeSeed("48271560391234");
assert(spec, "decode valid 14-digit code");
assert(spec!.dial_code === "4827156039", "dial code prefix");
assert(spec!.instance_id === "1234", "instance id suffix");
assert(spec!.world_type === "heightened", "D1 band heightened");
assert(spec!.place_grain === 8, "D2");
assert(spec!.law_count >= 1, "law count");
assert(spec!.constraints.length > 0, "constraints");
assert(spec!.crossed_pressures.length > 0, "crossed");

const legacy = decodeSeed("4827156039");
assert(legacy!.dial_code === "4827156039", "legacy 10-digit dial code");
assert(legacy!.instance_id === "", "legacy has no instance id");

const grounded = decodeSeed("1999999999");
assert(grounded!.world_type === "grounded", "low D1 grounded");
assert(grounded!.tone <= 4, "tone clamped for grounded");
assert(clampTone(9, "grounded") === 4, "clampTone grounded");
assert(clampTone(9, "fantastical") === 9, "clampTone fantastical");

const bad = decodeSeed("abc");
assert(bad === null, "reject non-numeric");
assert(decodeSeed("123") === null, "reject too short");

const made = makeSeedCode();
assert(isValidCode(made), "makeSeedCode valid");
assert(made.length === 14, "new codes are 14 digits");

const table = formatDialTableForDebug(spec!);
assert(table.includes("INSTANCE ID"), "dial table shows instance id");
assert(table.includes("World type"), "dial table lists all axes");

const block = formatWorldSpecForPrompt(spec!);
assert(block.includes("WORLDSPEC"), "prompt block");
assert(block.includes(spec!.code), "includes code");
assert(block.includes("INSTANCE ID"), "prompt mentions instance id");
assert(!block.toLowerCase().includes("murder mystery"), "no plot genre");

const parts = parseSeedCode("48271560398765");
assert(parts!.instance_id === "8765", "parse suffix");

console.log("worldSpec tests passed");
