// 0834 T-025 — NotificationsForm.
//
// Rendering-pure checkbox group for notification preferences. Security
// alerts are forced-on (disabled-checked) per AC-US10-01. The host
// computes the dirty diff and submits via PATCH.
//
// AC-US10-01, AC-US10-02, AC-US10-03.

import { useEffect, useState } from "react";
import type { NotificationPrefsDTO } from "../../types/account";

/**
 * Mutable preference keys — `securityAlerts` is excluded because the
 * platform DTO pins it to literal `true`. The form lists it but never
 * lets the user (or `update`) toggle it.
 */
type MutablePrefKey = "weeklyDigest" | "commentReplies" | "productUpdates";
type AllPrefKey = MutablePrefKey | "securityAlerts";

interface PrefMeta {
  key: AllPrefKey;
  label: string;
  helper?: string;
  forcedOn?: boolean;
  defaultOn: boolean;
}

const PREFS: ReadonlyArray<PrefMeta> = [
  {
    key: "weeklyDigest",
    label: "Weekly digest",
    helper: "Daily/weekly digest emails ship in a future update.",
    defaultOn: false,
  },
  {
    key: "securityAlerts",
    label: "Security alerts",
    helper: "We'll always notify you about suspicious account activity.",
    forcedOn: true,
    defaultOn: true,
  },
  {
    key: "commentReplies",
    label: "Comment replies",
    defaultOn: true,
  },
  {
    key: "productUpdates",
    label: "Product updates",
    helper: "Marketing emails — opt out anytime.",
    defaultOn: false,
  },
];

export interface NotificationsFormProps {
  prefs: NotificationPrefsDTO;
  onSubmit(next: NotificationPrefsDTO): Promise<void> | void;
  saving?: boolean;
  errorMessage?: string | null;
}

export function NotificationsForm({
  prefs,
  onSubmit,
  saving = false,
  errorMessage = null,
}: NotificationsFormProps) {
  const [local, setLocal] = useState<NotificationPrefsDTO>(() => coerce(prefs));

  useEffect(() => {
    setLocal(coerce(prefs));
  }, [prefs]);

  const isDirty =
    local.weeklyDigest !== prefs.weeklyDigest ||
    local.commentReplies !== prefs.commentReplies ||
    local.productUpdates !== prefs.productUpdates;

  function update(key: MutablePrefKey, value: boolean) {
    setLocal((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isDirty || saving) return;
    // securityAlerts stays literal true — the wire contract requires it
    // and the platform DTO type enforces it.
    await onSubmit({ ...local, securityAlerts: true });
  }

  return (
    <form
      data-testid="notifications-form"
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 560,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {PREFS.map((p) => (
          <Row
            key={p.key}
            meta={p}
            checked={p.forcedOn ? true : Boolean(local[p.key])}
            disabled={saving || Boolean(p.forcedOn)}
            onChange={(v) => {
              // The forced-on row never reaches this branch (its checkbox
              // is disabled) but the type system can't see that, so we
              // narrow explicitly here.
              if (p.key !== "securityAlerts") update(p.key, v);
            }}
          />
        ))}
      </div>

      {errorMessage && (
        <div
          role="alert"
          data-testid="notifications-form-error"
          style={{
            padding: "8px 12px",
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid rgba(220, 38, 38, 0.4)",
            color: "#991b1b",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {errorMessage}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="submit"
          data-testid="notifications-save-button"
          disabled={!isDirty || saving}
          style={{
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "inherit",
            border: `1px solid ${
              !isDirty || saving
                ? "var(--border-default, #e5e7eb)"
                : "var(--color-accent, #2563eb)"
            }`,
            background:
              !isDirty || saving
                ? "var(--bg-canvas, #f3f4f6)"
                : "var(--color-accent, #2563eb)",
            color:
              !isDirty || saving
                ? "var(--text-tertiary, #9ca3af)"
                : "#fff",
            borderRadius: 6,
            cursor: !isDirty || saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </form>
  );
}

function Row({
  meta,
  checked,
  disabled,
  onChange,
}: {
  meta: PrefMeta;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      data-testid={`notif-row-${meta.key}`}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: 12,
        border: "1px solid var(--border-default, #e5e7eb)",
        borderRadius: 6,
        background: "var(--bg-elevated, #fff)",
        cursor: disabled && !meta.forcedOn ? "not-allowed" : "pointer",
        opacity: disabled && !meta.forcedOn ? 0.7 : 1,
      }}
    >
      <input
        type="checkbox"
        data-testid={`notif-checkbox-${meta.key}`}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2 }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-primary)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {meta.label}
          {meta.forcedOn && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                padding: "2px 8px",
                background: "rgba(37, 99, 235, 0.1)",
                color: "#1d4ed8",
                borderRadius: 999,
              }}
            >
              Always on
            </span>
          )}
        </span>
        {meta.helper && (
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {meta.helper}
          </span>
        )}
      </span>
    </label>
  );
}

function coerce(prefs: NotificationPrefsDTO): NotificationPrefsDTO {
  return {
    weeklyDigest: Boolean(prefs.weeklyDigest),
    securityAlerts: true, // forced-on invariant
    commentReplies: prefs.commentReplies ?? true,
    productUpdates: Boolean(prefs.productUpdates),
  };
}
