"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildPlayerTimeline,
  timelineKindLabel,
  type TimelineEvent,
  type TimelineEventKind,
} from "@/lib/playerTimeline";

type Turn = { role: "user" | "assistant"; content: string };

type Props = {
  open: boolean;
  onClose: () => void;
  history: Turn[];
};

const FILTER_KINDS: { id: "all" | TimelineEventKind; label: string }[] = [
  { id: "all", label: "all" },
  { id: "action", label: "actions" },
  { id: "intro", label: "people" },
  { id: "scene", label: "scenes" },
  { id: "beat", label: "world" },
  { id: "consequence", label: "fallout" },
];

function EventNode({ event }: { event: TimelineEvent }) {
  return (
    <li className={`tl-event kind-${event.kind}`}>
      <div className="tl-rail" aria-hidden>
        <span className="tl-dot" />
      </div>
      <div className="tl-body">
        <div className="tl-meta">
          <span className="tl-turn">T{event.turn}</span>
          <span className="tl-kind">{timelineKindLabel(event.kind)}</span>
        </div>
        <div className="tl-label">{event.label}</div>
        {event.detail ? <div className="tl-detail">{event.detail}</div> : null}
      </div>
    </li>
  );
}

export default function TimelinePanel({ open, onClose, history }: Props) {
  const [filter, setFilter] = useState<"all" | TimelineEventKind>("all");

  const timeline = useMemo(() => buildPlayerTimeline(history), [history]);

  const filtered = useMemo(() => {
    if (filter === "all") return timeline.events;
    if (filter === "intro") {
      return timeline.events.filter(
        (e) => e.kind === "intro" || e.kind === "memory"
      );
    }
    return timeline.events.filter((e) => e.kind === filter);
  }, [timeline.events, filter]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const subBits = [
    `${timeline.events.length} events`,
    `turn ${timeline.currentTurn}`,
    timeline.timeOfDay,
    timeline.location?.replace(/_/g, " "),
  ].filter(Boolean);

  return (
    <div
      className="debug-overlay"
      role="dialog"
      aria-label="Story timeline"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="debug-panel tl-panel">
        <header className="debug-head">
          <div>
            <div className="debug-title">STORY TIMELINE</div>
            <div className="debug-sub">
              what happened so far · Esc to close
              {subBits.length ? ` · ${subBits.join(" · ")}` : ""}
            </div>
          </div>
          <div className="debug-head-actions">
            <button type="button" className="restart" onClick={onClose}>
              close
            </button>
          </div>
        </header>

        <div className="tl-filters" role="tablist" aria-label="Filter events">
          {FILTER_KINDS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`tl-filter ${filter === f.id ? "active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="tl-scroll">
          {filtered.length === 0 ? (
            <div className="tl-empty">
              No events yet. Act in the world — people, places, and fallout
              will collect here.
            </div>
          ) : (
            <ol className="tl-list">
              {filtered.map((event) => (
                <EventNode key={event.id} event={event} />
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
