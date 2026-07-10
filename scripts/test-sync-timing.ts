import {
  formatMs,
  formatSyncTimingTable,
  formatSyncWaitSec,
  type SyncTimingRecord,
} from "../lib/syncTiming";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(formatMs(450) === "450ms", "sub-second ms");
assert(formatMs(1500) === "1.50s", "seconds");
assert(formatSyncWaitSec(840) === "0.84s", "sync sec badge");
assert(formatSyncWaitSec(1534) === "1.53s", "sync sec rounds");

const records: SyncTimingRecord[] = [
  {
    turn: 1,
    userAction: "look around",
    sceneChars: 200,
    typingMs: 3200,
    syncWaitMs: 0,
    totalMs: 3200,
  },
  {
    turn: 2,
    userAction: "open the wallet",
    sceneChars: 91,
    typingMs: 1500,
    syncWaitMs: 840,
    totalMs: 2340,
  },
];

const table = formatSyncTimingTable(records);
assert(table.includes("look around"), "action in table");
assert(table.includes("840ms"), "sync wait in table");
assert(table.includes("Last turn:"), "summary line");

console.log("syncTiming tests passed");
