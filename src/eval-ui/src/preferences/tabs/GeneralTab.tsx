import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Callout, FormRow, Section, Segmented, Toggle } from "../components/primitives";
import type { TabProps } from "../lib/tab-types";

export function GeneralTab({ bridge, snapshot, onSnapshotChanged, pushToast }: TabProps) {
  const { t } = useTranslation("preferences");
  const isBrowser = !bridge.available;

  const onThemeChange = useCallback(
    async (next: "system" | "light" | "dark") => {
      try {
        await bridge.setSetting("general.theme", next);
        await onSnapshotChanged();
      } catch {
        pushToast({ message: "Couldn't update theme.", variant: "error" });
      }
    },
    [bridge, onSnapshotChanged, pushToast],
  );

  const onAutostartChange = useCallback(
    async (next: boolean) => {
      try {
        await bridge.setAutostart(next);
        await bridge.setSetting("general.launchAtLogin", next);
        await onSnapshotChanged();
      } catch {
        pushToast({
          message: t("general.launchAtLogin.errorAdmin"),
          variant: "error",
          actions: [
            {
              label: t("general.launchAtLogin.openSettings"),
              onClick: () => {
                /* desktop bridge wires the deep-link in the Tauri command */
              },
            },
          ],
        });
        await onSnapshotChanged();
      }
    },
    [bridge, onSnapshotChanged, pushToast, t],
  );

  const onPickFolder = useCallback(async () => {
    try {
      const path = await bridge.pickFolder();
      if (path) {
        await bridge.setSetting("general.defaultProjectFolder", path);
        await onSnapshotChanged();
      }
    } catch {
      pushToast({ message: "Couldn't open folder picker.", variant: "error" });
    }
  }, [bridge, onSnapshotChanged, pushToast]);

  const theme = snapshot?.general.theme ?? "system";
  const launchAtLogin = snapshot?.general.launchAtLogin ?? false;
  const defaultProjectFolder = snapshot?.general.defaultProjectFolder ?? null;

  return (
    <>
      <header className="preferences-content__heading">
        <h1>{t("general.heading")}</h1>
        <p>{t("general.subheading")}</p>
      </header>

      {isBrowser ? (
        <Callout variant="info">
          <strong>{t("common.browserMode")}</strong>
          <span>{t("app.browserCallout")}</span>
          <a href={t("app.downloadUrl")} target="_blank" rel="noopener noreferrer">
            {t("app.downloadLink")}
          </a>
        </Callout>
      ) : null}

      <Section title={t("general.theme.label")}>
        <FormRow
          label={t("general.theme.label")}
          help={t("general.theme.help")}
          control={
            <Segmented
              ariaLabel={t("general.theme.label")}
              value={theme}
              onChange={onThemeChange}
              options={[
                { value: "system", label: t("general.theme.system") },
                { value: "light", label: t("general.theme.light") },
                { value: "dark", label: t("general.theme.dark") },
              ]}
            />
          }
        />
      </Section>

      <Section title={t("tabs.general")}>
        <FormRow
          label={t("general.launchAtLogin.label")}
          help={
            isBrowser ? t("general.launchAtLogin.browserDisabled") : t("general.launchAtLogin.help")
          }
          control={
            <Toggle
              ariaLabel={t("general.launchAtLogin.label")}
              checked={launchAtLogin}
              onChange={onAutostartChange}
              disabled={isBrowser}
            />
          }
        />
        <FormRow
          stacked
          label={t("general.defaultProject.label")}
          help={t("general.defaultProject.help")}
          control={
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
              <code className="pref-path-display" style={{ flex: 1 }}>
                {defaultProjectFolder ?? t("general.defaultProject.notSet")}
              </code>
              <button
                type="button"
                className="pref-button"
                disabled={isBrowser}
                aria-disabled={isBrowser || undefined}
                onClick={onPickFolder}
              >
                {t("general.defaultProject.choose")}
              </button>
            </div>
          }
        />
        <FormRow
          label={t("general.language.label")}
          help={t("general.language.help")}
          control={
            <select
              className="pref-select"
              defaultValue="en"
              aria-label={t("general.language.label")}
            >
              <option value="en">{t("general.language.english")}</option>
            </select>
          }
        />
      </Section>
    </>
  );
}
