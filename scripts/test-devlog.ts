import { entrySignificance, getDevlogByDay } from "../lib/devlog";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const days = getDevlogByDay();
assert(days.length >= 3, "multiple day groups");

const jul10 = days.find((d) => d.date === "2026-07-10");
assert(jul10, "jul 10 group");
assert(jul10!.entries.length >= 10, "jul 10 has combined entries");

const sigs = jul10!.entries.map(entrySignificance);
for (let i = 1; i < sigs.length; i++) {
  assert(sigs[i] <= sigs[i - 1], "jul 10 sorted by significance desc");
}

assert(jul10!.entries[0].id === "2026-07-10-v53", "top jul 10 entry is v5.3 bundle");

assert(days[0].date >= days[1].date, "newest day first");

console.log("devlog tests passed");
