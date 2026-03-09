import { useState, useEffect } from "react";
import { useSSE } from "../sse";
import { api } from "../api";
import type { SkillInfo, ActivationResult, ActivationSummary } from "../types";

const CLASSIFICATION_STYLES: Record<string, { bg: string; text: string; icon: string }> = {
  TP: { bg: "var(--green-muted)", text: "var(--green)", icon: "check" },
  TN: { bg: "rgba(52,211,153,0.06)", text: "rgba(52,211,153,0.6)", icon: "check" },
  FP: { bg: "var(--red-muted)", text: "var(--red)", icon: "x" },
  FN: { bg: "rgba(248,113,113,0.06)", text: "rgba(248,113,113,0.6)", icon: "x" },
};

const PROMPT_TEMPLATES = [
  { label: "Should activate", prompts: [
    "How do I use this feature?",
    "Show me best practices for this",
    "What's the recommended approach?",
  ]},
  { label: "Should NOT activate", prompts: [
    "!What's the weather today?",
    "!Write me a poem",
    "!How do I cook pasta?",
  ]},
];

export function ActivationTestPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<{ plugin: string; skill: string } | null>(null);
  const [skillDescription, setSkillDescription] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [promptsText, setPromptsText] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [descriptionView, setDescriptionView] = useState<"raw" | "preview">("preview");
  const { events, running, done, error, start } = useSSE();

  useEffect(() => {
    api.getSkills().then(setSkills).catch(() => {});
  }, []);

  // Load skill description when selection changes
  useEffect(() => {
    if (!selectedSkill) {
      setSkillDescription(null);
      setRawContent(null);
      return;
    }
    fetch(`/api/skills/${selectedSkill.plugin}/${selectedSkill.skill}/description`)
      .then((r) => r.json())
      .then((d) => {
        setSkillDescription(d.description);
        setRawContent(d.rawContent || null);
      })
      .catch(() => {
        setSkillDescription(null);
        setRawContent(null);
      });
  }, [selectedSkill]);

  function handleRun() {
    if (!selectedSkill) return;
    const lines = promptsText.trim().split("\n").filter(Boolean);
    const prompts = lines.map((line) => {
      const shouldNot = line.startsWith("!");
      return {
        prompt: shouldNot ? line.slice(1).trim() : line.trim(),
        expected: shouldNot ? "should_not_activate" as const : "should_activate" as const,
      };
    });
    start(`/api/skills/${selectedSkill.plugin}/${selectedSkill.skill}/activation-test`, { prompts });
  }

  function addTemplatePrompts(prompts: string[]) {
    const current = promptsText.trim();
    const newText = current ? `${current}\n${prompts.join("\n")}` : prompts.join("\n");
    setPromptsText(newText);
  }

  const results: ActivationResult[] = [];
  let summary: (ActivationSummary & { description?: string }) | null = null;
  for (const evt of events) {
    if (evt.event === "prompt_result") results.push(evt.data as ActivationResult);
    if (evt.event === "done") summary = evt.data as ActivationSummary & { description?: string };
  }

  const correctResults = results.filter((r) => r.classification === "TP" || r.classification === "TN");
  const incorrectResults = results.filter((r) => r.classification === "FP" || r.classification === "FN");

  return (
    <div className="px-10 py-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Description Activation Test
        </h2>
        <p className="text-[13px] mt-1 max-w-2xl" style={{ color: "var(--text-tertiary)" }}>
          Tests whether a skill's description activates correctly for relevant prompts and stays silent for irrelevant ones.
          This validates the <strong>auto-activation quality</strong> of your skill description.
        </p>
      </div>

      {/* Two-column layout: config + description preview */}
      <div className="grid grid-cols-5 gap-5 mb-6">
        {/* Left: config */}
        <div className="col-span-3 space-y-4">
          {/* Skill selector */}
          <div>
            <label className="text-[12px] font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Skill</label>
            <select
              className="input-field"
              value={selectedSkill ? `${selectedSkill.plugin}/${selectedSkill.skill}` : ""}
              onChange={(e) => {
                const [p, s] = e.target.value.split("/");
                setSelectedSkill(p && s ? { plugin: p, skill: s } : null);
              }}
            >
              <option value="">Select a skill...</option>
              {skills.map((s) => (
                <option key={`${s.plugin}/${s.skill}`} value={`${s.plugin}/${s.skill}`}>
                  {s.plugin} / {s.skill}
                </option>
              ))}
            </select>
          </div>

          {/* Prompts textarea */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>Test Prompts</label>
              <div className="flex gap-1.5">
                {PROMPT_TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => addTemplatePrompts(t.prompts)}
                    className="text-[10px] px-2 py-1 rounded-md transition-colors duration-150"
                    style={{ background: "var(--surface-2)", color: "var(--text-tertiary)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "var(--surface-3)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.background = "var(--surface-2)"; }}
                  >
                    + {t.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className="input-field h-32 resize-y font-mono text-[12px]"
              value={promptsText}
              onChange={(e) => setPromptsText(e.target.value)}
              placeholder={"How do I write a unit test?\nWhat edge cases should I test?\n!What's the weather like today?\n!Write me a poem about flowers"}
            />
            <div className="flex items-center gap-4 mt-1.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              <span>One prompt per line</span>
              <span className="flex items-center gap-1">
                <code className="px-1 rounded" style={{ background: "var(--surface-2)" }}>!</code> prefix = should NOT activate
              </span>
              <span>{promptsText.trim().split("\n").filter(Boolean).length} prompt{promptsText.trim().split("\n").filter(Boolean).length !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>

        {/* Right: skill description preview */}
        <div className="col-span-2">
          <div className="glass-card h-full flex flex-col">
            <button
              onClick={() => setShowDescription(!showDescription)}
              className="w-full p-3 flex items-center justify-between text-left flex-shrink-0"
              style={{ borderBottom: showDescription ? "1px solid var(--border-subtle)" : undefined }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                Skill Description
              </span>
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5"
                style={{ transform: showDescription ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s ease" }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showDescription && (
              <div className="flex-1 flex flex-col min-h-0 animate-fade-in">
                {/* Raw / Preview tabs */}
                {rawContent && (
                  <div className="flex gap-0 border-b flex-shrink-0" style={{ borderColor: "var(--border-subtle)" }}>
                    {(["preview", "raw"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setDescriptionView(tab)}
                        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-150"
                        style={{
                          color: descriptionView === tab ? "var(--text-primary)" : "var(--text-tertiary)",
                          borderBottom: descriptionView === tab ? "2px solid var(--accent)" : "2px solid transparent",
                        }}
                      >
                        {tab === "raw" ? "Raw MD" : "Preview"}
                      </button>
                    ))}
                  </div>
                )}
                <div className="p-3 flex-1 overflow-auto" style={{ maxHeight: 320 }}>
                  {!selectedSkill ? (
                    <div className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>Select a skill to see its description</div>
                  ) : !skillDescription && !rawContent ? (
                    <div className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>Loading description...</div>
                  ) : descriptionView === "raw" && rawContent ? (
                    <pre
                      className="text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono"
                      style={{ color: "var(--text-secondary)", margin: 0 }}
                    >{rawContent}</pre>
                  ) : (
                    <div
                      className="text-[12px] leading-relaxed skill-md-preview"
                      style={{ color: "var(--text-secondary)" }}
                      dangerouslySetInnerHTML={{ __html: renderSkillMarkdown(rawContent || skillDescription || "") }}
                    />
                  )}
                </div>
              </div>
            )}
            {!showDescription && skillDescription && (
              <div className="px-3 pb-3 pt-1">
                <div className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
                  {skillDescription.slice(0, 100)}{skillDescription.length > 100 ? "..." : ""}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <button onClick={handleRun} disabled={running || !selectedSkill || !promptsText.trim()} className="btn btn-primary mb-7">
        {running ? (
          <><div className="spinner" style={{ borderTopColor: "#fff", borderColor: "rgba(255,255,255,0.2)", width: 14, height: 14 }} /> Testing...</>
        ) : (
          <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg> Run Activation Test</>
        )}
      </button>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
          {error}
        </div>
      )}

      {/* Results — split into correct and incorrect */}
      {results.length > 0 && (
        <div className="space-y-5 mb-6">
          {/* Incorrect results first (most actionable) */}
          {incorrectResults.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <span className="text-[12px] font-semibold" style={{ color: "var(--red)" }}>
                  Incorrect ({incorrectResults.length})
                </span>
                <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>— These need attention</span>
              </div>
              <div className="space-y-1.5 stagger-children">
                {incorrectResults.map((r, i) => (
                  <ResultRow key={`incorrect-${i}`} result={r} />
                ))}
              </div>
            </div>
          )}

          {/* Correct results */}
          {correctResults.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><polyline points="16 10 11 15 8 12" />
                </svg>
                <span className="text-[12px] font-semibold" style={{ color: "var(--green)" }}>
                  Correct ({correctResults.length})
                </span>
              </div>
              <div className="space-y-1.5 stagger-children">
                {correctResults.map((r, i) => (
                  <ResultRow key={`correct-${i}`} result={r} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary metrics */}
      {summary && (
        <div className="glass-card p-6 animate-fade-in-scale" style={{ borderColor: "var(--border-active)", borderWidth: 2 }}>
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: "var(--text-tertiary)" }}>
            Summary
          </div>

          <div className="grid grid-cols-3 gap-6 mb-5">
            <MetricCard
              label="Precision"
              value={summary.precision}
              description="Of all activations, how many were correct?"
              detail={`${summary.tp} true / ${summary.tp + summary.fp} total activations`}
            />
            <MetricCard
              label="Recall"
              value={summary.recall}
              description="Of expected activations, how many fired?"
              detail={`${summary.tp} activated / ${summary.tp + summary.fn} expected`}
            />
            <MetricCard
              label="Reliability"
              value={summary.reliability}
              description="Overall correct classification rate"
              detail={`${summary.tp + summary.tn} correct / ${summary.total} total`}
            />
          </div>

          {/* Confusion matrix */}
          <div className="pt-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-3 text-center" style={{ color: "var(--text-tertiary)" }}>
              Confusion Matrix
            </div>
            <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto">
              <ConfusionCell label="True Positive" abbr="TP" count={summary.tp} bg="var(--green-muted)" color="var(--green)" description="Correctly activated" />
              <ConfusionCell label="False Positive" abbr="FP" count={summary.fp} bg="var(--red-muted)" color="var(--red)" description="Wrongly activated" />
              <ConfusionCell label="False Negative" abbr="FN" count={summary.fn} bg="rgba(248,113,113,0.06)" color="rgba(248,113,113,0.6)" description="Missed activation" />
              <ConfusionCell label="True Negative" abbr="TN" count={summary.tn} bg="rgba(52,211,153,0.06)" color="rgba(52,211,153,0.6)" description="Correctly silent" />
            </div>
          </div>
        </div>
      )}

      {/* Loading state */}
      {running && results.length === 0 && (
        <div className="text-center py-16 animate-fade-in">
          <div className="spinner-lg mx-auto mb-4" />
          <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>Testing activation against skill description...</p>
        </div>
      )}
    </div>
  );
}

function ResultRow({ result }: { result: ActivationResult }) {
  const cs = CLASSIFICATION_STYLES[result.classification] || CLASSIFICATION_STYLES.FN;
  const isCorrect = result.classification === "TP" || result.classification === "TN";

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-xl transition-all duration-200"
      style={{ background: cs.bg, border: "1px solid transparent" }}
    >
      {/* Classification badge */}
      <div className="flex-shrink-0 mt-0.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${cs.text} 20%, transparent)` }}
        >
          {isCorrect ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={cs.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={cs.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{result.prompt}</span>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <span className="pill" style={{
            background: "rgba(0,0,0,0.1)",
            color: cs.text,
            fontWeight: 700,
            fontSize: "10px",
            padding: "1px 6px",
          }}>
            {result.classification}
          </span>
          <span style={{ color: result.activate ? "var(--green)" : "var(--text-tertiary)" }}>
            {result.activate ? "Activated" : "Silent"}
          </span>
          <span style={{ color: "var(--text-tertiary)" }}>·</span>
          <span style={{ color: "var(--text-tertiary)" }}>
            Expected: {result.expected === "should_activate" ? "activate" : "stay silent"}
          </span>
          <span style={{ color: "var(--text-tertiary)" }}>·</span>
          <span style={{ color: "var(--text-tertiary)" }}>{result.confidence} confidence</span>
        </div>
        {result.reasoning && (
          <div className="text-[11px] mt-1.5" style={{ color: "var(--text-tertiary)" }}>{result.reasoning}</div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, description, detail }: { label: string; value: number; description: string; detail: string }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "var(--green)" : pct >= 60 ? "var(--yellow)" : "var(--red)";

  return (
    <div className="text-center">
      <div className="text-[28px] font-bold tracking-tight" style={{ color }}>{pct}%</div>
      <div className="text-[12px] font-medium mt-0.5" style={{ color: "var(--text-secondary)" }}>{label}</div>
      <div className="text-[10px] mt-1" style={{ color: "var(--text-tertiary)" }}>{description}</div>
      <div className="text-[10px] mt-0.5 font-mono" style={{ color: "var(--text-tertiary)" }}>{detail}</div>
    </div>
  );
}

function ConfusionCell({ label, abbr, count, bg, color, description }: {
  label: string; abbr: string; count: number; bg: string; color: string; description: string;
}) {
  return (
    <div className="text-center p-3 rounded-lg" style={{ background: bg }}>
      <div className="text-[20px] font-bold" style={{ color }}>{count}</div>
      <div className="text-[11px] font-semibold" style={{ color }}>{abbr}</div>
      <div className="text-[9px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{description}</div>
    </div>
  );
}

/** Lightweight markdown-to-HTML renderer for SKILL.md preview (no deps). */
function renderSkillMarkdown(md: string): string {
  // Strip frontmatter
  const stripped = md.replace(/^---[\s\S]*?---\n?/, "");

  const lines = stripped.split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];

  function flushTable() {
    if (!inTable || tableRows.length === 0) return;
    inTable = false;
    const rows = tableRows.map((row) => {
      const cells = row.split("|").slice(1, -1).map((c) => c.trim());
      return cells;
    });
    // Skip separator row (row[1] if it's ---/---)
    const headerRow = rows[0];
    const dataRows = rows.filter((_, i) => {
      if (i === 0) return false;
      if (i === 1 && rows[i].every((c) => /^[-:\s]+$/.test(c))) return false;
      return true;
    });
    let html = `<table style="width:100%;border-collapse:collapse;font-size:11px;margin:8px 0">`;
    if (headerRow) {
      html += `<thead><tr>${headerRow.map((c) => `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border-subtle);color:var(--text-secondary);font-weight:600">${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
    }
    html += `<tbody>${dataRows.map((r) => `<tr>${r.map((c) => `<td style="padding:4px 8px;border-bottom:1px solid var(--border-subtle);color:var(--text-tertiary)">${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    out.push(html);
    tableRows = [];
  }

  for (const line of lines) {
    // Code blocks
    if (line.startsWith("```")) {
      if (inCode) {
        out.push(`<pre style="background:var(--surface-2);padding:8px 12px;border-radius:6px;font-size:11px;overflow-x:auto;margin:6px 0;color:var(--text-secondary)">${escapeHtml(codeLines.join("\n"))}</pre>`);
        codeLines = [];
        inCode = false;
      } else {
        flushTable();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // Table rows
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      if (!inTable) inTable = true;
      tableRows.push(line.trim());
      continue;
    } else {
      flushTable();
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      out.push(`<hr style="border:none;border-top:1px solid var(--border-subtle);margin:12px 0" />`);
      continue;
    }

    // Headers
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const level = h[1].length;
      const sizes = ["", "16px", "14px", "13px", "12px"];
      const weights = ["", "700", "600", "600", "600"];
      const margins = ["", "16px 0 8px", "12px 0 6px", "10px 0 4px", "8px 0 4px"];
      out.push(`<div style="font-size:${sizes[level]};font-weight:${weights[level]};margin:${margins[level]};color:var(--text-primary)">${inlineFormat(escapeHtml(h[2]))}</div>`);
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line.trim())) {
      const text = line.trim().replace(/^[-*]\s+/, "");
      out.push(`<div style="padding-left:16px;margin:2px 0;color:var(--text-secondary)"><span style="color:var(--text-tertiary);margin-right:6px">•</span>${inlineFormat(escapeHtml(text))}</div>`);
      continue;
    }

    // Ordered list
    const ol = line.trim().match(/^(\d+)\.\s+(.+)$/);
    if (ol) {
      out.push(`<div style="padding-left:16px;margin:2px 0;color:var(--text-secondary)"><span style="color:var(--text-tertiary);margin-right:6px">${ol[1]}.</span>${inlineFormat(escapeHtml(ol[2]))}</div>`);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      out.push(`<div style="height:6px"></div>`);
      continue;
    }

    // Paragraph
    out.push(`<div style="margin:2px 0;color:var(--text-secondary)">${inlineFormat(escapeHtml(line))}</div>`);
  }

  flushTable();
  return out.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineFormat(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:var(--text-primary)">$1</strong>`)
    .replace(/\*(.+?)\*/g, `<em>$1</em>`)
    .replace(/`([^`]+)`/g, `<code style="background:var(--surface-2);padding:1px 4px;border-radius:3px;font-size:10px">$1</code>`);
}
