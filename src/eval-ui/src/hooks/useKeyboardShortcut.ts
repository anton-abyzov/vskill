import { useEffect, useRef } from "react";

/**
 * Single registry of keyboard shortcuts for the studio shell.
 *
 * Design notes (T-037):
 *  - One document-level `keydown` listener per hook instance, attached on
 *    mount and torn down on unmount. We do NOT maintain a global singleton
 *    registry here — every consumer gets its own slot, which keeps cleanup
 *    obvious and avoids leaking handlers across hot-reloads.
 *  - Typing in `<input>`, `<textarea>`, `[contenteditable]`, or the native
 *    command palette input suppresses single-character shortcuts such as
 *    `/`, `j`, `k`, `?`, and `e`. Modifier-qualified chords like `cmd+k`,
 *    `ctrl+b`, and `cmd+shift+d` are NEVER suppressed — those exist to
 *    escape the focused input.
 *  - `Escape` always passes through (input-fields rely on it to clear).
 *  - The caller's handler decides whether to `preventDefault` — the hook
 *    only dispatches.
 */

export interface ShortcutModifiers {
  meta?: boolean; // ⌘ on macOS, Windows key elsewhere
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface Shortcut extends ShortcutModifiers {
  /**
   * A single key or a chord string.
   *
   * Key form:         "j", "k", "/", "?", "Escape", "Enter"
   * Chord shorthand:  "cmd+k", "ctrl+b", "cmd+shift+d"
   *
   * When using the chord shorthand, modifier fields are inferred from the
   * string — you don't need to set both.
   */
  key: string;
  /** Handler fired when the key combo matches. */
  handler: (event: KeyboardEvent) => void;
  /**
   * When true, the shortcut fires even when an input/textarea/contenteditable
   * element has focus. Default is false (input-aware suppression).
   * Modifier-qualified chords always ignore input context automatically.
   */
  allowInInputs?: boolean;
}

interface ParsedShortcut {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  allowInInputs: boolean;
  handler: (event: KeyboardEvent) => void;
}

/** Parse "cmd+shift+d" → {meta:true, shift:true, key:"d"}. Pure — testable. */
export function parseShortcut(spec: Shortcut): ParsedShortcut {
  const parts = spec.key.split("+").map((p) => p.trim()).filter(Boolean);
  let meta = !!spec.meta;
  let ctrl = !!spec.ctrl;
  let shift = !!spec.shift;
  let alt = !!spec.alt;
  let key = spec.key;
  if (parts.length > 1) {
    for (const p of parts.slice(0, -1)) {
      const lower = p.toLowerCase();
      if (lower === "cmd" || lower === "meta" || lower === "⌘") meta = true;
      else if (lower === "ctrl" || lower === "control") ctrl = true;
      else if (lower === "shift") shift = true;
      else if (lower === "alt" || lower === "option") alt = true;
    }
    key = parts[parts.length - 1];
  }
  return {
    key: key.length === 1 ? key.toLowerCase() : key,
    meta,
    ctrl,
    shift,
    alt,
    allowInInputs: !!spec.allowInInputs,
    handler: spec.handler,
  };
}

/** True if the event target is a text-entry element. */
export function isTypingContext(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  // jsdom doesn't always reflect contenteditable → isContentEditable, so also
  // inspect the raw attribute — covers both real browsers and test environments.
  const ce = target.getAttribute("contenteditable");
  if (ce != null && ce !== "false") return true;
  // role="textbox" (e.g., ARIA combobox input wrappers)
  if (target.getAttribute("role") === "textbox") return true;
  return false;
}

/** True if the pressed keyboard event matches the parsed shortcut. */
export function matchesShortcut(e: KeyboardEvent, s: ParsedShortcut): boolean {
  const hasMeta = !!e.metaKey;
  const hasCtrl = !!e.ctrlKey;
  const hasShift = !!e.shiftKey;
  const hasAlt = !!e.altKey;
  if (hasMeta !== s.meta) return false;
  if (hasCtrl !== s.ctrl) return false;
  if (hasShift !== s.shift) return false;
  if (hasAlt !== s.alt) return false;
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return eventKey === s.key;
}

/**
 * Register one or more shortcuts. The hook accepts either a single shortcut
 * object or an array; both are keyed by reference equality, so pass stable
 * handlers (useCallback) when they close over changing state.
 *
 * @param shortcuts    A single shortcut or array of shortcuts to register.
 * @param options.enabled  Disable the listener without unmounting the hook.
 * @param options.target   DOM target for the listener — defaults to window.
 */
export interface UseKeyboardShortcutOptions {
  enabled?: boolean;
  target?: Window | Document | HTMLElement;
}

export function useKeyboardShortcut(
  shortcuts: Shortcut | Shortcut[],
  options: UseKeyboardShortcutOptions = {},
): void {
  const { enabled = true, target } = options;
  const parsedRef = useRef<ParsedShortcut[]>([]);

  const list = Array.isArray(shortcuts) ? shortcuts : [shortcuts];
  parsedRef.current = list.map(parseShortcut);

  useEffect(() => {
    if (!enabled) return;
    const t: EventTarget =
      target ?? (typeof window !== "undefined" ? window : (undefined as unknown as EventTarget));
    if (!t) return;

    function onKeyDown(event: Event) {
      const e = event as KeyboardEvent;
      const typing = isTypingContext(e.target);
      for (const s of parsedRef.current) {
        if (!matchesShortcut(e, s)) continue;
        const chord = s.meta || s.ctrl || s.alt;
        if (typing && !s.allowInInputs && !chord) continue;
        s.handler(e);
        // One handler per keystroke — first match wins. Prevents accidental
        // double-fires if two shortcuts overlap (e.g. "?" in Navigation and
        // Actions groups).
        return;
      }
    }

    t.addEventListener("keydown", onKeyDown);
    return () => {
      t.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, target]);
}
