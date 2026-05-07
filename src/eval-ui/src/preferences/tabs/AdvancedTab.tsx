import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Callout, Dialog, FormRow, Section } from "../components/primitives";
import type { TabProps } from "../lib/tab-types";

const SETTINGS_PATH_DESKTOP_DEFAULT = "~/.vskill/settings.json";

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
