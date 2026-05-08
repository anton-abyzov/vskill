import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Callout, Dialog, FormRow, Section } from "../components/primitives";
import type { TabProps } from "../lib/tab-types";

const SETTINGS_PATH_DESKTOP_DEFAULT = "~/.vskill/settings.json";

// 0832 T-011: per-option tooltip text. Shown via native `title` on the select
// (good enough for desktop and screen-reader users; matches the rest of this
// tab's affordances).
function tooltipForLifecycleDefault(value: string): string {
  switch (value) {
    case "ask":
      return "Show the lifecycle modal whenever another studio instance is detected.";
    case "use-existing":
      return "Always switch to the running instance — no modal, no extra sidecar.";
    case "stop-and-replace":
      return "SIGTERM the existing instance (3s grace, then SIGKILL) and start this app's sidecar.";
    case "run-alongside":
      return "Start this app's sidecar on a fresh port; both instances coexist.";
    default:
      return "";
  }
}

export function AdvancedTab({ bridge, snapshot, onSnapshotChanged, pushToast }: TabProps) {
  const { t } = useTranslation("preferences");
  const isBrowser = !bridge.available;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [settingsPath, setSettingsPath] = useState<string>(SETTINGS_PATH_DESKTOP_DEFAULT);

  useEffect(() => {
    if (isBrowser) {
      setSettingsPath(t("advanced.settingsPath.browserValue"));
      return;
    }
    setSettingsPath(SETTINGS_PATH_DESKTOP_DEFAULT);
  }, [isBrowser, t]);

  const logLevel = snapshot?.advanced.logLevel ?? "info";
  // 0832: studio process-lifecycle default. Falls back to "ask" until the
  // backend reports a value (browser shadow defaults match the desktop one).
  const lifecycleDefault = snapshot?.studio?.lifecycleDefault ?? "ask";

  const onLogLevelChange = useCallback(
    async (next: string) => {
      try {
        await bridge.setSetting("advanced.logLevel", next);
        await onSnapshotChanged();
      } catch {
        pushToast({ message: "Couldn't update log level.", variant: "error" });
      }
    },
    [bridge, onSnapshotChanged, pushToast],
  );

  const onLifecycleDefaultChange = useCallback(
    async (next: string) => {
      try {
        await bridge.setSetting("studio.lifecycleDefault", next);
        await onSnapshotChanged();
      } catch {
        pushToast({
          message: "Couldn't update studio lifecycle default.",
          variant: "error",
        });
      }
    },
    [bridge, onSnapshotChanged, pushToast],
  );

  const onCopyPath = useCallback(async () => {
    try {
      await bridge.copyToClipboard(settingsPath);
      pushToast({ message: t("advanced.settingsPath.copied") });
    } catch {
      pushToast({ message: "Couldn't copy.", variant: "error" });
    }
  }, [bridge, pushToast, settingsPath, t]);

  const onReveal = useCallback(async () => {
    try {
      await bridge.revealSettingsFile();
    } catch {
      pushToast({ message: "Couldn't open settings file.", variant: "error" });
    }
  }, [bridge, pushToast]);

  const onConfirmReset = useCallback(async () => {
    try {
      await bridge.resetSettings();
      await onSnapshotChanged();
      pushToast({ message: t("advanced.factoryReset.done"), variant: "success" });
    } catch {
      pushToast({ message: "Couldn't reset preferences.", variant: "error" });
    } finally {
      setConfirmOpen(false);
    }
  }, [bridge, onSnapshotChanged, pushToast, t]);

  return (
    <>
      <header className="preferences-content__heading">
        <h1>{t("advanced.heading")}</h1>
        <p>{t("advanced.subheading")}</p>
      </header>

      <Section title={t("advanced.logLevel.label")}>
        <FormRow
          label={t("advanced.logLevel.label")}
          help={t("advanced.logLevel.help")}
          control={
            <select
              className="pref-select"
              value={logLevel}
              onChange={(e) => onLogLevelChange(e.target.value)}
              disabled={isBrowser}
              aria-disabled={isBrowser || undefined}
              aria-label={t("advanced.logLevel.label")}
            >
              <option value="error">{t("advanced.logLevel.error")}</option>
              <option value="warn">{t("advanced.logLevel.warn")}</option>
              <option value="info">{t("advanced.logLevel.info")}</option>
              <option value="debug">{t("advanced.logLevel.debug")}</option>
              <option value="trace">{t("advanced.logLevel.trace")}</option>
            </select>
          }
        />
      </Section>

      {/* 0832 T-011: studio process-lifecycle default action. */}
      <Section title="Studio lifecycle">
        <FormRow
          label="When another Skill Studio is already running"
          help="Choose what the desktop app should do at launch when an existing instance is detected. 'Ask each time' shows the modal; the others run silently."
          control={
            <select
              className="pref-select"
              value={lifecycleDefault}
              onChange={(e) => onLifecycleDefaultChange(e.target.value)}
              disabled={isBrowser}
              aria-disabled={isBrowser || undefined}
              aria-label="Studio lifecycle default"
              title={tooltipForLifecycleDefault(lifecycleDefault)}
            >
              <option value="ask">Ask each time (default)</option>
              <option value="use-existing">Use existing instance</option>
              <option value="stop-and-replace">Stop existing + use this app</option>
              <option value="run-alongside">Run alongside</option>
            </select>
          }
        />
      </Section>

      <Section title={t("advanced.settingsPath.label")}>
        <FormRow
          stacked
          label={t("advanced.settingsPath.label")}
          help={t("advanced.settingsPath.help")}
          control={
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <code className="pref-path-display" style={{ flex: 1, minWidth: 200 }}>
                {settingsPath}
              </code>
              <button type="button" className="pref-button" onClick={onCopyPath}>
                {t("advanced.settingsPath.copy")}
              </button>
              <button
                type="button"
                className="pref-button"
                onClick={onReveal}
                disabled={isBrowser}
                aria-disabled={isBrowser || undefined}
              >
                {t("advanced.settingsPath.reveal")}
              </button>
            </div>
          }
        />
      </Section>

      <Section title={t("advanced.factoryReset.label")}>
        <FormRow
          label={t("advanced.factoryReset.label")}
          help={t("advanced.factoryReset.help")}
          control={
            <button
              type="button"
              className="pref-button pref-button--danger"
              onClick={() => setConfirmOpen(true)}
            >
              {t("advanced.factoryReset.button")}
            </button>
          }
        />
      </Section>

      {isBrowser ? (
        <Callout variant="info">{t("app.browserCallout")}</Callout>
      ) : null}

      <Dialog
        open={confirmOpen}
        onDismiss={() => setConfirmOpen(false)}
        ariaLabel={t("advanced.factoryReset.confirmTitle")}
      >
        <h2 className="pref-dialog__title">{t("advanced.factoryReset.confirmTitle")}</h2>
        <p className="pref-dialog__body">{t("advanced.factoryReset.confirmBody")}</p>
        <div className="pref-dialog__actions">
          <button
            type="button"
            className="pref-button"
            onClick={() => setConfirmOpen(false)}
          >
            {t("advanced.factoryReset.cancel")}
          </button>
          <button
            type="button"
            className="pref-button pref-button--danger"
            onClick={onConfirmReset}
          >
            {t("advanced.factoryReset.confirm")}
          </button>
        </div>
      </Dialog>
    </>
  );
}
