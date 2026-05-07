import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Callout, FormRow, Section, Toggle } from "../components/primitives";
import type { TabProps } from "../lib/tab-types";

export function PrivacyTab({ bridge, snapshot, onSnapshotChanged, pushToast }: TabProps) {
  const { t } = useTranslation("preferences");
  const isBrowser = !bridge.available;

  const telemetry = snapshot?.privacy.telemetryEnabled ?? false;
  const crash = snapshot?.privacy.crashReportingEnabled ?? false;

  const onToggle = useCallback(
    async (path: string, next: boolean, label: string) => {
      try {
        await bridge.setSetting(path, next);
        await onSnapshotChanged();
      } catch {
        pushToast({ message: `Couldn't update ${label}.`, variant: "error" });
      }
    },
    [bridge, onSnapshotChanged, pushToast],
  );

  const onOpenLogs = useCallback(async () => {
    try {
      await bridge.openLogsFolder();
    } catch {
      pushToast({ message: "Couldn't open logs folder.", variant: "error" });
    }
  }, [bridge, pushToast]);

  return (
    <>
      <header className="preferences-content__heading">
        <h1>{t("privacy.heading")}</h1>
        <p>{t("privacy.subheading")}</p>
      </header>

      <Callout variant="info">{t("privacy.disclosure")}</Callout>

      <Section title={t("privacy.heading")}>
        <FormRow
          label={t("privacy.telemetry.label")}
          help={t("privacy.telemetry.help")}
          control={
            <Toggle
              ariaLabel={t("privacy.telemetry.label")}
              checked={telemetry}
              onChange={(next) => onToggle("privacy.telemetryEnabled", next, "telemetry")}
            />
          }
        />
        <FormRow
          label={t("privacy.crash.label")}
          help={t("privacy.crash.help")}
          control={
            <Toggle
              ariaLabel={t("privacy.crash.label")}
              checked={crash}
              onChange={(next) => onToggle("privacy.crashReportingEnabled", next, "crash reporting")}
            />
          }
        />
        {isBrowser ? null : (
          <FormRow
            label={t("privacy.openLogs.label")}
            help={t("privacy.openLogs.help")}
            control={
              <button type="button" className="pref-button" onClick={onOpenLogs}>
                {t("privacy.openLogs.label")}
              </button>
            }
          />
        )}
      </Section>
    </>
  );
}
