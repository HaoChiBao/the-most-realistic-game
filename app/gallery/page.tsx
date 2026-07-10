"use client";

import { useEffect, useState } from "react";

type World = {
  code: string;
  setting: string;
  opening: string;
  play_count: number;
  created_at: string;
};

export default function GalleryPage() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">(
    "loading"
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/seeds/popular?limit=48");
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        const list: World[] = Array.isArray(data.worlds) ? data.worlds : [];
        setWorlds(list);
        setStatus(list.length ? "ready" : "empty");
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="crt">
      <div className="screen">
        <div className="gallery-head">
          <span>SHARED WORLDS  //  MOST PLAYED</span>
          <span className="patch-head-links">
            <a className="restart" href="/patch-notes">
              patch notes
            </a>
            <a className="restart" href="/">
              new world
            </a>
          </span>
        </div>

        <div className="gallery-body">
          {status === "loading" && (
            <div className="entry system">scanning the archive...</div>
          )}
          {status === "error" && (
            <div className="entry error">COULD NOT REACH THE ARCHIVE.</div>
          )}
          {status === "empty" && (
            <div className="entry system">
              no shared worlds yet. generate one and hit “share world”.
            </div>
          )}

          {status === "ready" &&
            worlds.map((w) => (
              <a key={w.code} className="world-card" href={`/s/${w.code}`}>
                <div className="world-setting">{w.setting || "unknown world"}</div>
                <div className="world-meta">
                  <span>SEED {w.code}</span>
                  <span>
                    {w.play_count} {w.play_count === 1 ? "play" : "plays"}
                  </span>
                </div>
              </a>
            ))}
        </div>

        <div className="meta">
          <span>THE MOST REALISTIC GAME</span>
          <span className="controls">
            <a className="restart" href="/patch-notes" style={{ marginLeft: 12 }}>
              patch notes
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
