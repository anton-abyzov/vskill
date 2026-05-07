import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ToastStack, type ToastSpec } from "./components/primitives";
import { useDesktopBridge, useSettingsSnapshot } from "./lib/useDesktopBridge";

const GeneralTab = lazy(() => import("./tabs/GeneralTab").then((m) => ({ default: m.GeneralTab })));
const UpdatesTab = lazy(() => import("./tabs/UpdatesTab").then((m) => ({ default: m.UpdatesTab })));
const PrivacyTab = lazy(() => import("./tabs/PrivacyTab").then((m) => ({ default: m.PrivacyTab })));
const AdvancedTab = lazy(() => import("./tabs/AdvancedTab").then((m) => ({ default: m.AdvancedTab })));

type TabKey = "general" | "updates" | "privacy" | "advanced";

const TABS: { key: TabKey; iconChar: string; shortcut: string }[] = [
  { key: "general", iconChar: "⚙", shortcut: "1" },
  { key: "updates", iconChar: "↻", shortcut: "2" },
  { key: "privacy", iconChar: "⚓", shortcut: "3" },
  { key: "advanced", iconChar: "⁂", shortcut: "4" },
];

function readHashTab(): TabKey {
  const raw = (typeof window !== "undefined" && window.location.hash.slice(1)) || "general";
  if (raw === "general" || raw === "updates" || raw === "privacy" || raw === "advanced") return raw;
  return "general";
}

export function PreferencesApp() {
  const { t } = useTranslation("preferences");
  const bridge = useDesktopBridge();
  const { snapshot, refresh } = useSettingsSnapshot(bridge);
  const [activeTab, setActiveTab] = useState<TabKey>(() => readHashTab());
  const [toasts, setToasts] = useState<ToastSpec[]>([]);

  const pushToast = useCallback((spec: Omit<ToastSpec, "id">) => {
    setToasts((prev) => [...prev, { ...spec, id: `t-${Date.now()}-${Math.random()}` }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handler = () => setActiveTab(readHashTab());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  useEffect(() => {
    if (window.location.hash.slice(1) !== activeTab) {
      window.history.replaceState(null, "", `#${activeTab}`);
    }
  }, [activeTab]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const idx = parseInt(e.key, 10);
      if (Number.isNaN(idx)) return;
      const tab = TABS[idx - 1];
      if (!tab) return;
      e.preventDefault();
      setActiveTab(tab.key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const theme = snapshot.general.theme;
    if (theme === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = () => {
        document.documentElement.dataset.theme = mql.matches ? "dark" : "light";
        document.documentElement.dataset.themeMode = "auto";
      };
      apply();
      mql.addEventListener("change", apply);
      return () => mql.removeEventListener("change", apply);
    }
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = theme;
  }, [snapshot]);

  return (
    <div className="preferences-window">
      <nav className="preferences-sidebar" aria-label={t("app.title")}>
        <div className="preferences-sidebar__brand">{t("app.brand")}</div>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="preferences-nav-item"
            aria-current={activeTab === tab.key ? "page" : undefined}
            onClick={() => setActiveTab(tab.key)}
          >
            <span aria-hidden="true" className="preferences-nav-item__icon">
              {tab.iconChar}
            </span>
            <span>{t(`tabs.${tab.key}`)}</span>
            <span className="preferences-nav-item__shortcut" aria-hidden="true">
              {/^Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+"}
              {tab.shortcut}
            </span>
          </button>
        ))}
      </nav>
      <main className="preferences-content" data-active-tab={activeTab}>
        <Suspense fallback={<div className="pref-status-row">{t("common.loading")}</div>}>
          {activeTab === "general" ? (
            <GeneralTab
              bridge={bridge}
              snapshot={snapshot}
              onSnapshotChanged={refresh}
              pushToast={pushToast}
            />
          ) : null}
          {activeTab === "updates" ? (
            <UpdatesTab
              bridge={bridge}
              snapshot={snapshot}
              onSnapshotChanged={refresh}
              pushToast={pushToast}
            />
          ) : null}
          {activeTab === "privacy" ? (
            <PrivacyTab
              bridge={bridge}
              snapshot={snapshot}
              onSnapshotChanged={refresh}
              pushToast={pushToast}
            />
          ) : null}
          {activeTab === "advanced" ? (
            <AdvancedTab
              bridge={bridge}
              snapshot={snapshot}
              onSnapshotChanged={refresh}
              pushToast={pushToast}
            />
          ) : null}
        </Suspense>
      </main>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export type { TabKey };
