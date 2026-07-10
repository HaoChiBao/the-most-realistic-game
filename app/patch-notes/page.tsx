import { getDevlogByDay } from "@/lib/devlog";

export const metadata = {
  title: "Patch notes — THE MOST REALISTIC GAME",
  description: "Public devlog and patch notes for THE MOST REALISTIC GAME.",
};

function formatDayHeading(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const month = months[Number(m[2]) - 1];
  if (!month) return iso;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

export default function PatchNotesPage() {
  const days = getDevlogByDay();

  return (
    <div className="crt">
      <div className="screen">
        <div className="gallery-head">
          <span>PATCH NOTES  //  DEVLOG</span>
          <span className="patch-head-links">
            <a className="restart" href="/gallery">
              worlds
            </a>
            <a className="restart" href="/">
              new world
            </a>
          </span>
        </div>

        <div className="patch-body">
          {days.length === 0 && (
            <div className="entry system">no transmissions yet.</div>
          )}

          {days.map((day) => (
            <section key={day.date} className="patch-day">
              <header className="patch-day-head">
                <time dateTime={day.date}>{formatDayHeading(day.date)}</time>
                <span className="patch-day-count">
                  {day.entries.length}{" "}
                  {day.entries.length === 1 ? "update" : "updates"}
                </span>
              </header>

              <div className="patch-day-entries">
                {day.entries.map((entry) => (
                  <article key={entry.id} className="patch-entry">
                    <header className="patch-entry-head">
                      <div className="patch-version">
                        v{entry.version}
                        {entry.engine ? `  //  ENGINE ${entry.engine}` : ""}
                      </div>
                    </header>
                    <h2 className="patch-title">{entry.title}</h2>
                    <p className="patch-summary">{entry.summary}</p>
                    {entry.tags && entry.tags.length > 0 && (
                      <div className="patch-tags">
                        {entry.tags.map((tag) => (
                          <span key={tag} className="patch-tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <ul className="patch-changes">
                      {entry.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                    {entry.linear && entry.linear.length > 0 && (
                      <div className="patch-linear">
                        {entry.linear.join(" · ")}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="meta">
          <span>THE MOST REALISTIC GAME</span>
          <span className="controls">
            <a className="restart" href="/gallery" style={{ marginLeft: 12 }}>
              worlds
            </a>
            <a className="restart" href="/" style={{ marginLeft: 12 }}>
              back to terminal
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}
