import { useState } from "react";
import { useStudio } from "../StudioContext";

interface Props {
  variant: "no-selection" | "no-skills" | "no-project-skills" | "error" | "no-results";
  message?: string;
  onRetry?: () => void;
}

function FallbackIcon() {
  return (
    <div
      className="w-16 h-16 rounded-2xl flex items-center justify-center"
      style={{ background: "var(--surface-2)" }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    </div>
  );
}

export function EmptyState({ variant, message, onRetry }: Props) {
  const { setMode, setSearch } = useStudio();
  const [imgError, setImgError] = useState(false);

  if (variant === "no-selection") {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 animate-fade-in">
        <div className="mb-5">
          {!imgError ? (
            <img
              src="/images/empty-studio.webp"
              width={128}
              height={128}
              alt=""
              onError={() => setImgError(true)}
              style={{ objectFit: "contain" }}
            />
          ) : (
            <FallbackIcon />
          )}
        </div>
        <p className="text-[14px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
          Select a skill to view details
        </p>
        <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          Choose a skill from the list to edit, test, and evaluate
        </p>
      </div>
    );
  }

  if (variant === "no-skills") {
    return (
      <div className="text-center py-12 px-4 animate-fade-in-scale">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: "var(--surface-2)" }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        </div>
        <p className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>No skills found</p>
        <p className="text-[12px] mt-1 mb-4" style={{ color: "var(--text-tertiary)" }}>
          Check your <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: "var(--surface-2)" }}>--root</code> directory, or create your first skill
        </p>
        <button
          onClick={() => setMode("create")}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150"
          style={{ background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer" }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.9"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create Your First Skill
        </button>
      </div>
    );
  }

  if (variant === "no-project-skills") {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 animate-fade-in" data-testid="empty-state-no-project-skills">
        <div className="mb-5">
          {!imgError ? (
            <img
              src="/images/empty-studio.webp"
              width={128}
              height={128}
              alt=""
              onError={() => setImgError(true)}
              style={{ objectFit: "contain" }}
            />
          ) : (
            <FallbackIcon />
          )}
        </div>
        <p className="text-[15px] font-medium mb-1" style={{ color: "var(--text-primary)" }}>
          No skills installed for this project yet.
        </p>
        <p className="text-[12px] mb-5" style={{ color: "var(--text-tertiary)", maxWidth: 360, textAlign: "center" }}>
          Browse the marketplace to install one, or author a new skill from scratch.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="empty-state-browse-marketplaces"
            onClick={() => {
              window.dispatchEvent(new CustomEvent("studio:open-marketplace"));
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150"
            style={{ background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer" }}
            aria-label="Browse marketplaces"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            Browse marketplaces
          </button>
          <button
            type="button"
            data-testid="empty-state-create-skill"
            onClick={() => setMode("create")}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-default, var(--border-subtle))", cursor: "pointer" }}
            aria-label="Create new skill"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create new skill
          </button>
        </div>
      </div>
    );
  }

  if (variant === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 animate-fade-in">
        <div
          className="px-5 py-4 rounded-lg text-center max-w-sm"
          style={{ background: "var(--red-muted)", border: "1px solid rgba(248,113,113,0.2)" }}
        >
          <p className="text-[13px] mb-3" style={{ color: "var(--red)" }}>
            {message || "Failed to load skill data"}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-2 rounded-lg text-[12px] font-medium"
              style={{ background: "var(--surface-3)", color: "var(--text-primary)", border: "none", cursor: "pointer" }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // no-results
  return (
    <div className="px-4 py-8 text-center animate-fade-in">
      <p className="text-[13px] mb-2" style={{ color: "var(--text-tertiary)" }}>
        No skills match your search
      </p>
      <button
        onClick={() => setSearch("")}
        className="text-[12px] font-medium"
        style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
      >
        Clear search
      </button>
    </div>
  );
}
