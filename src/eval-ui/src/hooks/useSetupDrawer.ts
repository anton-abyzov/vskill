// ---------------------------------------------------------------------------
// 0686 T-010 (US-005): useSetupDrawer — shared state + open/close helpers
// for the right-slide SetupDrawer.
//
// Contract:
//   - Single instance per Studio shell. Callers mount the drawer once near
//     the app root and route `open("anthropic-api")` calls through this
//     hook from any entry point (AgentModelPicker "Need help connecting?"
//     link, AgentScopePicker "Set up..." CTA, scope-empty-state buttons).
//   - AC-US5-07: when `beforeOpen` is provided (typically to close the
//     SettingsModal first), the callback runs BEFORE the drawer opens so
//     the single-modal-at-a-time contract is preserved.
//   - Dev-time assertion (NODE_ENV !== "production") for unknown provider
//     keys. Production silently renders the fallback via the registry.
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState } from "react";
import { SETUP_PROVIDER_CONTENT } from "../components/SetupDrawer.providers";

export interface UseSetupDrawerResult {
  open: (provider: string, opts?: { beforeOpen?: () => void }) => void;
  close: () => void;
  isOpen: boolean;
  providerKey: string | null;
}

export function useSetupDrawer(): UseSetupDrawerResult {
  const [isOpen, setIsOpen] = useState(false);
  const [providerKey, setProviderKey] = useState<string | null>(null);
  // Stores the element that was focused at open time so close can restore
  // focus (AC-US5-07). The trigger passes `document.activeElement` for us.
  const triggerRef = useRef<Element | null>(null);

  const open = useCallback((provider: string, opts?: { beforeOpen?: () => void }) => {
    if (process.env.NODE_ENV !== "production") {
      if (!(provider in SETUP_PROVIDER_CONTENT)) {
        // Dev-time assertion. Production silently renders the fallback.
        // eslint-disable-next-line no-console
        console.warn(
          `[useSetupDrawer] Unknown provider key "${provider}". ` +
            `Expected one of: ${Object.keys(SETUP_PROVIDER_CONTENT).join(", ")}`,
        );
      }
    }
    // Persist the current focus owner for later restoration.
    triggerRef.current =
      typeof document !== "undefined" ? document.activeElement : null;
    // Run any pre-open side effect (e.g., close SettingsModal) BEFORE the
    // drawer appears so we never have two modals mounted simultaneously.
    opts?.beforeOpen?.();
    setProviderKey(provider);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Restore focus to the trigger once React commits the unmount.
    const trigger = triggerRef.current;
    if (trigger && "focus" in trigger && typeof (trigger as HTMLElement).focus === "function") {
      // Defer so the focus move doesn't race the drawer's own blur events.
      queueMicrotask(() => (trigger as HTMLElement).focus());
    }
  }, []);

  return { open, close, isOpen, providerKey };
}
