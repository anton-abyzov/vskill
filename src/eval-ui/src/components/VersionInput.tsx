// ---------------------------------------------------------------------------
// VersionInput — semver-validated version input for the create-skill form.
// Ref: 0734 US-004 (AC-US4-01..AC-US4-07).
//
// Notes:
//   - Validation runs on blur (not on every keystroke) per AC-US4-02 to avoid
//     flagging the user mid-typing. The Submit-gating callback fires immediately
//     so the parent form can disable Submit before the user blurs (defensive).
//   - The "Versions" link renders only in update mode (no history in create mode).
//   - No new UI library introduced — bare <input> + Tailwind classes that match
//     the existing CreateSkillPage form fields.
// ---------------------------------------------------------------------------

import React from "react";
import { isValidSemver } from "../utils/semver";

const TOOLTIP_TEXT =
  "Skill version (semver). Auto-bumps on update unless versioningMode=author.";

const HELPER_TEXT_INVALID =
  "Must be valid semver (e.g. 1.0.0, 2.1.3-beta.1)";

export interface VersionInputProps {
  value: string;
  onChange: (next: string) => void;
  mode: "create" | "update";
  /** Called whenever validity changes — parent uses this to gate Submit. */
  onValidityChange?: (valid: boolean) => void;
  /** When set + mode === "update", renders a "Versions" link below the field. */
  versionsHref?: string;
  disabled?: boolean;
}

export function VersionInput(props: VersionInputProps): React.ReactElement {
  const { value, onChange, mode, onValidityChange, versionsHref, disabled } = props;

  // Initial validity is based on the prefill so Submit-gating is correct from
  // the first render. Tracked locally so the helper text only appears after
  // the user has interacted (touched flag).
  const [touched, setTouched] = React.useState(false);
  const [valid, setValid] = React.useState<boolean>(() => isValidSemver(value));

  // Re-evaluate on every render — keeps Submit-gating tight when the parent
  // pushes a new prop value. Helper text is still gated on `touched`.
  const currentValid = isValidSemver(value);
  React.useEffect(() => {
    if (currentValid !== valid) {
      setValid(currentValid);
      onValidityChange?.(currentValid);
    } else if (onValidityChange) {
      // Always emit at least once so the parent has the initial state.
      onValidityChange(currentValid);
    }
    // We intentionally re-emit on every change — onValidityChange must reflect
    // the present state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentValid]);

  const showError = touched && !currentValid;

  const inputClass = [
    "w-full rounded-md border px-3 py-2 text-sm font-mono",
    showError
      ? "border-red-500 bg-red-50 focus:outline-red-600"
      : "border-gray-300 bg-white focus:outline-blue-600",
    disabled ? "opacity-60 cursor-not-allowed" : "",
  ].join(" ");

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-700" htmlFor="version-input">
        Version
      </label>
      <input
        id="version-input"
        data-testid="version-input"
        type="text"
        title={TOOLTIP_TEXT}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={showError ? "true" : "false"}
        aria-describedby={showError ? "version-input-helper" : undefined}
        disabled={disabled}
        className={inputClass}
        placeholder="1.0.0"
      />
      {showError && (
        <span
          id="version-input-helper"
          data-testid="version-input-helper"
          className="text-xs text-red-600"
          role="alert"
        >
          {HELPER_TEXT_INVALID}
        </span>
      )}
      {mode === "update" && versionsHref && (
        <a
          data-testid="version-input-versions-link"
          href={versionsHref}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 hover:underline"
        >
          Versions →
        </a>
      )}
    </div>
  );
}
