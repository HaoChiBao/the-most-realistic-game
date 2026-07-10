import raw from "@/content/devlog.json";

export type DevlogEntry = {
  id: string;
  version: string;
  engine?: string;
  date: string;
  title: string;
  summary: string;
  tags?: string[];
  linear?: string[];
  changes: string[];
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

/** Newest-first public patch notes / devlog entries. */
export function getDevlogEntries(): DevlogEntry[] {
  const list = Array.isArray(raw) ? raw.filter(isEntry) : [];
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.version < b.version ? 1 : -1;
  });
}
