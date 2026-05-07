import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  id?: string;
}

export function Toggle({ checked, onChange, disabled, ariaLabel, id }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className="pref-toggle"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
    />
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className="pref-segmented"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          disabled={disabled}
          onClick={() => !disabled && onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface RowProps {
  label: string;
  help?: string;
  control: ReactNode;
  stacked?: boolean;
}

export function FormRow({ label, help, control, stacked }: RowProps) {
  return (
    <div className={`pref-row${stacked ? " pref-row--stacked" : ""}`}>
      <div className="pref-row__label">
        <span className="pref-row__label-text">{label}</span>
        {help ? <span className="pref-row__help">{help}</span> : null}
      </div>
      <div>{control}</div>
    </div>
  );
}

interface SectionProps {
  title?: string;
  children: ReactNode;
  style?: CSSProperties;
}

export function Section({ title, children, style }: SectionProps) {
  return (
    <section className="pref-section" style={style}>
      {title ? <h2 className="pref-section__title">{title}</h2> : null}
      {children}
    </section>
  );
}

interface CalloutProps {
  variant?: "info" | "warning";
  children: ReactNode;
}

export function Callout({ variant = "info", children }: CalloutProps) {
  return (
    <div
      role="note"
      className={`pref-callout${variant === "info" ? " pref-callout--info" : ""}`}
    >
      {children}
    </div>
  );
}

interface DialogProps {
  open: boolean;
  onDismiss?: () => void;
  ariaLabel: string;
  children: ReactNode;
}

export function Dialog({ open, onDismiss, ariaLabel, children }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onDismiss) onDismiss();
    };
    document.addEventListener("keydown", handler);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", handler);
  }, [open, onDismiss]);

  if (!open) return null;
  return (
    <div
      className="pref-dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && onDismiss) onDismiss();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className="pref-dialog"
      >
        {children}
      </div>
    </div>
  );
}

interface ToastSpec {
  id: string;
  message: string;
  variant?: "info" | "error" | "success";
  actions?: { label: string; onClick: () => void }[];
}

interface ToastStackProps {
  toasts: ToastSpec[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      window.setTimeout(() => onDismiss(t.id), t.variant === "error" ? 8000 : 4000),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts, onDismiss]);

  return (
    <div className="pref-toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pref-toast${t.variant === "error" ? " pref-toast--error" : ""}`}
        >
          <span>{t.message}</span>
          {t.actions && t.actions.length > 0 ? (
            <div className="pref-toast__actions">
              {t.actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className="pref-button"
                  onClick={() => {
                    a.onClick();
                    onDismiss(t.id);
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export type { ToastSpec };
