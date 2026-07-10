/** Per-turn timing: visible scene reveal vs hidden [WORLD] / STATE sync. */

export type SyncTimingRecord = {
  turn: number;
  userAction: string | null;
  sceneChars: number;
  /** Request start → typewriter shows full scene. */
  typingMs: number;
  /** Scene fully shown → stream finished (0 if stream ended before display caught up). */
  syncWaitMs: number;
  /** Request start → turn fully complete. */
  totalMs: number;
};

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Seconds to nearest hundredth — for the terminal sync badge. */
export function formatSyncWaitSec(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatSyncTimingTable(records: SyncTimingRecord[]): string {
  if (records.length === 0) {
    return "(no turns recorded yet — timing is captured on each /api/game stream)";
  }

  const lines = [
    "SYNC TIMING — scene revealed → world state finished",
    "",
    "typingMs   = request start until on-screen text is fully revealed",
    "syncWaitMs = scene revealed until hidden [WORLD]/STATE stream completes",
    "totalMs    = request start until turn is ready for input",
    "",
    "TURN  ACTION                    SCENE  TYPING     SYNC WAIT  TOTAL",
    "----  ------------------------  -----  ---------  ---------  ---------",
  ];

  for (const r of records) {
    const action = (r.userAction ?? "(opening)").slice(0, 24).padEnd(24);
    lines.push(
      `${String(r.turn).padStart(4)}  ${action}  ${String(r.sceneChars).padStart(5)}  ${formatMs(r.typingMs).padStart(9)}  ${formatMs(r.syncWaitMs).padStart(9)}  ${formatMs(r.totalMs).padStart(9)}`
    );
  }

  const last = records[records.length - 1];
  lines.push("");
  lines.push(
    `Last turn: ${formatMs(last.syncWaitMs)} syncing after scene (${formatMs(last.typingMs)} typing, ${formatMs(last.totalMs)} total)`
  );

  return lines.join("\n");
}
