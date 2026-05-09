// 0834 T-025 — ProfileForm.
//
// Rendering-pure profile editor. Display name + bio are editable; the
// GitHub handle is read-only ("Synced from GitHub"); avatar is shown
// from the `avatarUrl` already bound to the GitHub identity. The host
// owns the network: this component takes `profile` + `onSubmit` and
// computes the dirty state internally.
//
// AC-US4-01, AC-US4-02.

import { useEffect, useState } from "react";
import type { ProfileDTO, ProfilePatchDTO } from "../../types/account";

const DISPLAY_NAME_MAX = 80;
const BIO_MAX = 280;

export interface ProfileFormProps {
  profile: ProfileDTO;
  /** Called with only the changed fields. Resolves on success. */
  onSubmit(patch: ProfilePatchDTO): Promise<void> | void;
  /** When true, all inputs disabled (network in flight). */
  saving?: boolean;
  /** Optional inline error from the most recent save attempt. */
  errorMessage?: string | null;
}

export function ProfileForm({
  profile,
  onSubmit,
  saving = false,
  errorMessage = null,
}: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [publicProfile, setPublicProfile] = useState(profile.publicProfile);

  // When the parent re-renders with new server data (e.g. after a save
  // refetch), reset local state so the form reflects truth.
  useEffect(() => {
    setDisplayName(profile.displayName);
    setBio(profile.bio ?? "");
    setPublicProfile(profile.publicProfile);
  }, [profile.userId, profile.displayName, profile.bio, profile.publicProfile]);

  const isDirty =
    displayName !== profile.displayName ||
    bio !== (profile.bio ?? "") ||
    publicProfile !== profile.publicProfile;

  const displayNameTooLong = displayName.length > DISPLAY_NAME_MAX;
  const bioTooLong = bio.length > BIO_MAX;
  const isValid =
    displayName.trim().length > 0 && !displayNameTooLong && !bioTooLong;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isDirty || !isValid || saving) return;
    const patch: ProfilePatchDTO = {};
    if (displayName !== profile.displayName) patch.displayName = displayName;
    if (bio !== (profile.bio ?? "")) patch.bio = bio || null;
    if (publicProfile !== profile.publicProfile) patch.publicProfile = publicProfile;
    await onSubmit(patch);
  }

  return (
    <form
      data-testid="profile-form"
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        maxWidth: 560,
        fontFamily: "var(--font-sans)",
      }}
    >
      <ProfileHeader profile={profile} />

      <Field label="Display name" htmlFor="profile-display-name">
        <input
          id="profile-display-name"
          data-testid="profile-display-name"
          type="text"
          value={displayName}
          maxLength={DISPLAY_NAME_MAX + 20}
          disabled={saving}
          onChange={(e) => setDisplayName(e.target.value)}
          style={inputStyle}
        />
        <Counter current={displayName.length} max={DISPLAY_NAME_MAX} />
      </Field>

      <Field
        label="GitHub handle"
        htmlFor="profile-github-handle"
        caption="Synced from GitHub"
      >
        <input
          id="profile-github-handle"
          type="text"
          value={profile.githubHandle}
          readOnly
          aria-readonly="true"
          style={{ ...inputStyle, background: "var(--bg-canvas, #f3f4f6)" }}
        />
      </Field>

      <Field label="Public bio" htmlFor="profile-bio">
        <textarea
          id="profile-bio"
          data-testid="profile-bio"
          value={bio}
          maxLength={BIO_MAX + 40}
          rows={3}
          disabled={saving}
          onChange={(e) => setBio(e.target.value)}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
        />
        <Counter current={bio.length} max={BIO_MAX} />
      </Field>

      <ToggleField
        label="Public profile page"
        helper="Your bio + public skills appear on a verified-skill.com/u/{handle} page."
        checked={publicProfile}
        disabled={saving}
        onChange={setPublicProfile}
      />

      {errorMessage && (
        <div
          role="alert"
          data-testid="profile-form-error"
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
          data-testid="profile-save-button"
          disabled={!isDirty || !isValid || saving}
          style={{
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "inherit",
            border: "1px solid var(--color-accent, #2563eb)",
            background:
              !isDirty || !isValid || saving
                ? "var(--bg-canvas, #f3f4f6)"
                : "var(--color-accent, #2563eb)",
            color:
              !isDirty || !isValid || saving
                ? "var(--text-tertiary, #9ca3af)"
                : "#fff",
            borderColor:
              !isDirty || !isValid || saving
                ? "var(--border-default, #e5e7eb)"
                : "var(--color-accent, #2563eb)",
            borderRadius: 6,
            cursor:
              !isDirty || !isValid || saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function ProfileHeader({ profile }: { profile: ProfileDTO }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      {profile.avatarUrl ? (
        <img
          src={profile.avatarUrl}
          alt={`Avatar for ${profile.githubHandle}`}
          width={56}
          height={56}
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            objectFit: "cover",
            border: "1px solid var(--border-default, #e5e7eb)",
            background: "var(--bg-canvas, #f3f4f6)",
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--bg-canvas, #f3f4f6)",
            border: "1px solid var(--border-default, #e5e7eb)",
          }}
        />
      )}
      <div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          {profile.displayName || profile.githubHandle}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          @{profile.githubHandle}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  caption,
  children,
}: {
  label: string;
  htmlFor: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        htmlFor={htmlFor}
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--text-primary)",
        }}
      >
        {label}
      </label>
      {children}
      {caption && (
        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
          {caption}
        </span>
      )}
    </div>
  );
}

function Counter({ current, max }: { current: number; max: number }) {
  const over = current > max;
  return (
    <span
      style={{
        alignSelf: "flex-end",
        fontSize: 11,
        color: over ? "#dc2626" : "var(--text-tertiary)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {current}/{max}
    </span>
  );
}

function ToggleField({
  label,
  helper,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  helper?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <input
        type="checkbox"
        data-testid="profile-public-toggle"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2 }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-primary)",
          }}
        >
          {label}
        </span>
        {helper && (
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {helper}
          </span>
        )}
      </span>
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  color: "var(--text-primary)",
  background: "var(--bg-elevated, #fff)",
  border: "1px solid var(--border-default, #e5e7eb)",
  borderRadius: 6,
  boxSizing: "border-box",
};
