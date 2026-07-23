"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildDebugSections,
  formatFullDump,
  type DebugSection,
  type SessionDebugMeta,
} from "@/lib/debugDump";
import {
  decodeSeed,
  dialBreakdown,
  formatDialTableForDebug,
  formatWorldSpecForPrompt,
  parseSeedCode,
} from "@/lib/worldSpec";

type Turn = { role: "user" | "assistant"; content: string };

type Props = {
  open: boolean;
  onClose: () => void;
  history: Turn[];
  meta: SessionDebugMeta;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function DebugPanel({ open, onClose, history, meta }: Props) {
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [openingInstruction, setOpeningInstruction] = useState<string | null>(
    null
  );
  const [engineVersion, setEngineVersion] = useState<string | undefined>(
    meta.engineVersion
  );
  const [model, setModel] = useState<string | null>(meta.model ?? null);
  const [provider, setProvider] = useState<string | null>(
    meta.provider ?? null
  );
  const [activeId, setActiveId] = useState("session");
  const [copied, setCopied] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/engine?debug=1");
        if (!res.ok) throw new Error(`engine ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setSystemPrompt(
          typeof data.systemPrompt === "string" ? data.systemPrompt : null
        );
        setOpeningInstruction(
          typeof data.openingInstruction === "string"
            ? data.openingInstruction
            : null
        );
        if (typeof data.version === "string") setEngineVersion(data.version);
        if (typeof data.model === "string") setModel(data.model);
        if (typeof data.provider === "string") setProvider(data.provider);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const sections: DebugSection[] = useMemo(() => {
    const parsed = meta.seedCode ? parseSeedCode(meta.seedCode) : null;
    const spec = meta.seedCode ? decodeSeed(meta.seedCode) : null;
    const seedDialTable = spec ? formatDialTableForDebug(spec) : null;
    const worldSpecJson = spec
      ? JSON.stringify(
          {
            code: spec.code,
            dial_code: spec.dial_code,
            instance_id: spec.instance_id || null,
            axes: dialBreakdown(spec),
            world_type: spec.world_type,
            law_count: spec.law_count,
            raw_digits: spec.raw_digits,
            effective_digits: spec.digits,
            labels: spec.labels,
            constraints: spec.constraints,
            crossed_pressures: spec.crossed_pressures,
            full: spec,
          },
          null,
          2
        )
      : null;
    const openingWithSpec =
      openingInstruction && spec
        ? `${openingInstruction}\n\n${formatWorldSpecForPrompt(spec)}`
        : openingInstruction;

    return buildDebugSections({
      history,
      meta: {
        ...meta,
        engineVersion: engineVersion ?? meta.engineVersion,
        model: model ?? meta.model ?? null,
        provider: provider ?? meta.provider ?? null,
        dialCode: parsed?.dial_code ?? null,
        instanceId: parsed?.instance_id || null,
      },
      systemPrompt,
      openingInstruction: openingWithSpec,
      worldSpecJson,
      seedDialTable,
    });
  }, [
    history,
    meta,
    systemPrompt,
    openingInstruction,
    engineVersion,
    model,
    provider,
  ]);

  useEffect(() => {
    if (!open) return;
    if (!sections.some((s) => s.id === activeId) && sections[0]) {
      setActiveId(sections[0].id);
    }
  }, [open, sections, activeId]);

  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  const flashCopied = useCallback((id: string) => {
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1400);
  }, []);

  const onCopySection = useCallback(async () => {
    if (!active) return;
    const ok = await copyText(active.body);
    if (ok) flashCopied(active.id);
  }, [active, flashCopied]);

  const onCopyAll = useCallback(async () => {
    const ok = await copyText(formatFullDump(sections));
    if (ok) flashCopied("all");
  }, [sections, flashCopied]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="debug-overlay"
      role="dialog"
      aria-label="Engine debug"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="debug-panel">
        <header className="debug-head">
          <div>
            <div className="debug-title">ENGINE DEBUG</div>
            <div className="debug-sub">
              organized dump · copy any section · Esc to close
              {model ? ` · model ${model}` : ""}
              {provider ? ` · ${provider}` : ""}
              {loadError ? ` · prompt fetch failed: ${loadError}` : ""}
            </div>
          </div>
          <div className="debug-head-actions">
            <button type="button" className="restart" onClick={onCopyAll}>
              {copied === "all" ? "copied all" : "copy all"}
            </button>
            <button type="button" className="restart" onClick={onClose}>
              close
            </button>
          </div>
        </header>

        <div className="debug-body">
          <nav className="debug-nav" aria-label="Debug sections">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`debug-nav-item ${
                  active?.id === s.id ? "active" : ""
                }`}
                onClick={() => setActiveId(s.id)}
              >
                {s.title}
              </button>
            ))}
          </nav>

          <div className="debug-main">
            <div className="debug-section-bar">
              <span>{active?.title}</span>
              <button type="button" className="restart" onClick={onCopySection}>
                {copied === active?.id ? "copied" : "copy section"}
              </button>
            </div>
            <pre className={`debug-pre kind-${active?.kind ?? "text"}`}>
              {active?.body ?? ""}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
