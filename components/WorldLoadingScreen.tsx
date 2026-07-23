"use client";

import { useEffect, useMemo, useState } from "react";

export type WorldLoadingPhase =
  | "boot"
  | "generating"
  | "revealing"
  | "loading-seed"
  | "done";

type Props = {
  active: boolean;
  phase: WorldLoadingPhase;
  seedCode?: string | null;
  isSharedSeed?: boolean;
};

const TIPS = [
  "Actions have consequences. Death is possible.",
  "Type anything after the >> prompt.",
  "Shared seeds load someone else's world — your choices diverge from there.",
  "The world keeps moving even when you hesitate.",
  "Use /commands in-game for developer introspection.",
  "Share a world once it's fully built — friends can walk the same opening.",
  "Short inputs cut deep. Ninety characters is enough to ruin a life.",
];

const PHASE_FLOOR: Record<WorldLoadingPhase, number> = {
  boot: 4,
  "loading-seed": 18,
  generating: 32,
  revealing: 68,
  done: 100,
};

const PHASE_CEILING: Record<WorldLoadingPhase, number> = {
  boot: 28,
  "loading-seed": 55,
  generating: 64,
  revealing: 96,
  done: 100,
};

function statusForPhase(
  phase: WorldLoadingPhase,
  isSharedSeed: boolean
): string {
  switch (phase) {
    case "boot":
      return isSharedSeed
        ? "Resolving shared seed..."
        : "Allocating world seed...";
    case "loading-seed":
      return "Restoring hidden world...";
    case "generating":
      return isSharedSeed
        ? "Waking autonomous actors..."
        : "Generating reality...";
    case "revealing":
      return "Writing the opening scene...";
    case "done":
      return "Entering world...";
  }
}

export default function WorldLoadingScreen({
  active,
  phase,
  seedCode,
  isSharedSeed = false,
}: Props) {
  const [progress, setProgress] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [visible, setVisible] = useState(active);
  const [exiting, setExiting] = useState(false);

  const status = useMemo(
    () => statusForPhase(phase, isSharedSeed),
    [phase, isSharedSeed]
  );

  useEffect(() => {
    if (active) {
      setVisible(true);
      setExiting(false);
      setProgress(0);
      setTipIndex(Math.floor(Math.random() * TIPS.length));
      return;
    }
    if (!visible) return;
    setExiting(true);
    const t = window.setTimeout(() => {
      setVisible(false);
      setExiting(false);
    }, 420);
    return () => window.clearTimeout(t);
  }, [active, visible]);

  useEffect(() => {
    if (!visible || exiting) return;
    const id = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, 4200);
    return () => window.clearInterval(id);
  }, [visible, exiting]);

  useEffect(() => {
    if (!visible) return;

    let raf = 0;
    let last = 0;

    const tick = (ts: number) => {
      if (!last) last = ts;
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;

      setProgress((prev) => {
        if (phase === "done") {
          return prev + (100 - prev) * Math.min(1, dt * 8);
        }
        const floor = PHASE_FLOOR[phase];
        const ceiling = PHASE_CEILING[phase];
        const base = Math.max(prev, floor);
        if (base >= ceiling) return base;
        // Creep slowly toward the phase ceiling so the bar never feels stuck.
        const remaining = ceiling - base;
        const step = Math.max(0.08, remaining * 0.35) * dt;
        return Math.min(ceiling, base + step);
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, phase]);

  if (!visible) return null;

  const shown = Math.min(100, Math.max(0, progress));

  return (
    <div
      className={`world-loading${exiting ? " world-loading--exit" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!exiting}
      aria-label="Loading world"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="world-loading__inner">
        <p className="world-loading__title">Generating world</p>
        {seedCode ? (
          <p className="world-loading__seed">SEED {seedCode}</p>
        ) : (
          <p className="world-loading__seed world-loading__seed--ghost">
            SEED ——————
          </p>
        )}

        <div className="world-loading__bar" aria-hidden="true">
          <div
            className="world-loading__bar-fill"
            style={{ width: `${shown}%` }}
          />
        </div>
        <p className="world-loading__pct">{Math.floor(shown)}%</p>
        <p className="world-loading__status">{status}</p>

        <div className="world-loading__chunks" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className={`world-loading__chunk${
                shown > (i + 1) * (100 / 12) - 4
                  ? " world-loading__chunk--on"
                  : ""
              }`}
              style={{ animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </div>

        <p className="world-loading__tip">
          <span className="world-loading__tip-label">Tip</span>
          {TIPS[tipIndex]}
        </p>
      </div>
    </div>
  );
}
