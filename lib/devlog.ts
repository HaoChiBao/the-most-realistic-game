import raw from "@/content/devlog.json";

export type DevlogEntry = {
  id: string;
  version: string;
  engine?: string;
  date: string;
  /** 1–100: higher = more important within the same calendar day. */
  significance?: number;
  title: string;
  summary: string;
  tags?: string[];
  linear?: string[];
  changes: string[];
};

export type DevlogDayGroup = {
  date: string;
  entries: DevlogEntry[];
};

function isEntry(value: unknown): value is DevlogEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.version === "string" &&
    typeof e.date === "string" &&
    typeof e.title === "string" &&
    typeof e.summary === "string" &&
    Array.isArray(e.changes)
  );
}

function listEntries(): DevlogEntry[] {
  return Array.isArray(raw) ? raw.filter(isEntry) : [];
}

/** Resolve sort weight: explicit significance, else semver as a weak fallback. */
export function entrySignificance(entry: DevlogEntry): number {
  if (typeof entry.significance === "number" && Number.isFinite(entry.significance)) {
    return Math.max(1, Math.min(100, Math.floor(entry.significance)));
  }
  const parts = entry.version.split(".").map((p) => Number(p));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return major * 100 + minor * 10 + patch;
}

function compareEntries(a: DevlogEntry, b: DevlogEntry): number {
  const sig = entrySignificance(b) - entrySignificance(a);
  if (sig !== 0) return sig;
  return b.version.localeCompare(a.version);
}

/** Patch notes grouped by day (newest day first). Within each day: highest significance first. */
export function getDevlogByDay(): DevlogDayGroup[] {
  const byDate = new Map<string, DevlogEntry[]>();
  for (const entry of listEntries()) {
    const bucket = byDate.get(entry.date) ?? [];
    bucket.push(entry);
    byDate.set(entry.date, bucket);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, entries]) => ({
      date,
      entries: [...entries].sort(compareEntries),
    }));
}

/** Flat list: newest day first, then significance within each day. */
export function getDevlogEntries(): DevlogEntry[] {
  return getDevlogByDay().flatMap((day) => day.entries);
}
