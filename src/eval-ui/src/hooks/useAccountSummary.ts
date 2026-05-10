// 0843 T-002 — useAccountSummary: thin React hook around the
// `account_get_user_summary` Tauri IPC.
//
// The IPC payload (`AccountUserSummary`) is the WebView-safe shape introduced
// by 0836 (no token, no PII beyond login + avatar). This hook polls once at
// mount and listens to any `studio:account-summary-refresh` CustomEvent that
// the auth flows already dispatch on sign-in / sign-out.
//
// Returns a stable object suitable for mounting gates (signed-in only) and
// tier-conditioned UI like SkillCountBadge. Defaults to a clean signed-out
// shape so consumers do not need null-checks.

import { useEffect, useState } from "react";
import {
  getAccountUserSummary,
  type AccountUserSummary,
} from "../contexts/AccountTauriBridge";

const DEFAULT_SUMMARY: AccountUserSummary = {
  signedIn: false,
  login: null,
  avatarUrl: null,
  tier: "free",
};

export function useAccountSummary(): AccountUserSummary {
  const [summary, setSummary] = useState<AccountUserSummary>(DEFAULT_SUMMARY);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getAccountUserSummary().then((next) => {
        if (!cancelled) setSummary(next);
      });
    };
    refresh();
    if (typeof window === "undefined") {
      return () => {
        cancelled = true;
      };
    }
    window.addEventListener("studio:account-summary-refresh", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("studio:account-summary-refresh", refresh);
    };
  }, []);

  return summary;
}
