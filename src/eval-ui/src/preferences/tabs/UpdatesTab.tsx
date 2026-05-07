import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Callout, Dialog, FormRow, Section, Segmented, Toggle } from "../components/primitives";
import type { TabProps } from "../lib/tab-types";
import type { AppMetadata, UpdateInfo } from "../lib/useDesktopBridge";

type CheckState = "idle" | "checking" | "up-to-date" | "available" | "error";
type InstallState = "idle" | "preparing" | "downloading" | "installing" | "ready-to-restart";
type ErrorKind = "network" | "signature" | "disk" | "unknown";

interface DialogState {
  open: boolean;
  update: UpdateInfo | null;
  installState: InstallState;
  progressBytes: number;
  totalBytes: number | null;
}

function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const delta = Date.now() - ts;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}

function detectErrorKind(message: string): ErrorKind {
  const lower = message.toLowerCase();
  if (lower.includes("signature") || lower.includes("verify")) return "signature";
  if (lower.includes("space") || lower.includes("disk")) return "disk";
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("connect"))
    return "network";
  return "unknown";
}

export function UpdatesTab({ bridge, snapshot, onSnapshotChanged, pushToast }: TabProps) {
  const { t } = useTranslation("preferences");
  const isBrowser = !bridge.available;

  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [latest, setLatest] = useState<UpdateInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [appMetadata, setAppMetadata] = useState<AppMetadata | null>(null);
  const [dialog, setDialog] = useState<DialogState>({
    open: false,
    update: null,
    installState: "idle",
    progressBytes: 0,
    totalBytes: null,
  });

  useEffect(() => {
    let cancelled = false;
    bridge
      .getAppMetadata()
      .then((m) => {
        if (!cancelled) setAppMetadata(m);
      })
      .catch(() => {
        /* surface via UI's "(unknown)" fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const channel = snapshot?.updates.channel ?? "stable";
  const autoCheck = snapshot?.updates.autoCheck ?? true;
  const lastCheckedRelative = formatRelative(snapshot?.updates.lastCheckedAt);

  const handleCheckNow = useCallback(async () => {
    if (isBrowser || checkState === "checking") return;
    setCheckState("checking");
    setErrorMessage(null);
    setErrorKind(null);
    try {
      const info = await bridge.checkForUpdates();
      setLatest(info);
      if (info.available) {
        setCheckState("available");
        setDialog({
          open: true,
          update: info,
          installState: "idle",
          progressBytes: 0,
          totalBytes: null,
        });
      } else {
        setCheckState("up-to-date");
        pushToast({ message: t("updates.upToDate"), variant: "success" });
      }
      await onSnapshotChanged();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setCheckState("error");
      setErrorMessage(message);
      setErrorKind(detectErrorKind(message));
    }
  }, [bridge, checkState, isBrowser, onSnapshotChanged, pushToast, t]);

  const handleChannelChange = useCallback(
    async (next: "stable" | "beta") => {
      try {
        await bridge.setSetting("updates.channel", next);
        await onSnapshotChanged();
        if (next === "beta") {
          pushToast({ message: t("updates.channel.betaUnavailable") });
        }
      } catch {
        pushToast({ message: "Couldn't update channel.", variant: "error" });
      }
    },
    [bridge, onSnapshotChanged, pushToast, t],
  );

  const handleAutoCheckChange = useCallback(
    async (next: boolean) => {
      try {
        await bridge.setSetting("updates.autoCheck", next);
        await onSnapshotChanged();
      } catch {
        pushToast({ message: "Couldn't update auto-check.", variant: "error" });
      }
    },
    [bridge, onSnapshotChanged, pushToast],
  );

  const handleInstall = useCallback(async () => {
    if (!dialog.update) return;
    setDialog((prev) => ({ ...prev, installState: "preparing" }));
    try {
      await bridge.downloadAndInstallUpdate((chunk, total) => {
        setDialog((prev) => ({
          ...prev,
          installState: "downloading",
          progressBytes: prev.progressBytes + chunk,
          totalBytes: total,
        }));
      });
      setDialog((prev) => ({ ...prev, installState: "ready-to-restart" }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const kind = detectErrorKind(message);
      setDialog((prev) => ({ ...prev, open: false, installState: "idle" }));
      setCheckState("error");
      setErrorMessage(message);
      setErrorKind(kind);
    }
  }, [bridge, dialog.update]);

  const handleSkipVersion = useCallback(async () => {
    if (!dialog.update?.latestVersion) return;
    await bridge.setSetting("updates.skippedVersion", dialog.update.latestVersion);
    setDialog((prev) => ({ ...prev, open: false }));
    await onSnapshotChanged();
  }, [bridge, dialog.update, onSnapshotChanged]);

  const handleSnoozeLater = useCallback(async () => {
    const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await bridge.setSetting("updates.snoozedUntil", snoozedUntil);
    setDialog((prev) => ({ ...prev, open: false }));
    await onSnapshotChanged();
  }, [bridge, onSnapshotChanged]);

  const handleRestart = useCallback(() => {
    setDialog((prev) => ({ ...prev, open: false }));
    pushToast({ message: t("updates.dialog.restartNow"), variant: "success" });
  }, [pushToast, t]);

  const renderDialog = () => {
    if (!dialog.open || !dialog.update) return null;
    const update = dialog.update;
    const installing =
      dialog.installState === "preparing" ||
      dialog.installState === "downloading" ||
      dialog.installState === "installing";
    const ready = dialog.installState === "ready-to-restart";

    const pct =
      dialog.totalBytes && dialog.totalBytes > 0
        ? Math.min(100, Math.round((dialog.progressBytes / dialog.totalBytes) * 100))
        : null;

    return (
      <Dialog
        open={dialog.open}
        onDismiss={() => setDialog((prev) => ({ ...prev, open: false }))}
        ariaLabel={t("updates.dialog.title")}
      >
        <h2 className="pref-dialog__title">{t("updates.dialog.title")}</h2>
        <p className="pref-dialog__body">
          {t("updates.dialog.version", { version: update.latestVersion ?? "?" })}
        </p>
        <div>
          <p className="pref-row__label-text" style={{ marginBottom: 6 }}>
            {t("updates.dialog.releaseNotes")}
          </p>
          <div className="pref-dialog__release-notes">
            {update.releaseNotes ?? t("updates.dialog.noReleaseNotes")}
          </div>
        </div>
        {installing ? (
          <div className="pref-progress">
            <div className="pref-progress__bar">
              <div
                className="pref-progress__fill"
                style={{ width: pct === null ? "30%" : `${pct}%` }}
              />
            </div>
            <span className="pref-progress__text">
              {dialog.installState === "preparing"
                ? t("updates.dialog.preparing")
                : t("updates.dialog.downloading")}
              {pct !== null ? ` (${pct}%)` : null}
            </span>
          </div>
        ) : null}
        <div className="pref-dialog__actions">
          {ready ? (
            <>
              <p className="pref-dialog__body" style={{ marginRight: "auto" }}>
                {t("updates.dialog.restartRequired")}
              </p>
              <button type="button" className="pref-button" onClick={handleRestart}>
                {t("updates.dialog.onQuit")}
              </button>
              <button
                type="button"
                className="pref-button pref-button--primary"
                onClick={handleRestart}
              >
                {t("updates.dialog.restartNow")}
              </button>
            </>
          ) : installing ? (
            <button
              type="button"
              className="pref-button"
              onClick={() => bridge.cancelUpdate().catch(() => undefined)}
            >
              {t("updates.dialog.cancel")}
            </button>
          ) : (
            <>
              <button type="button" className="pref-button" onClick={handleSkipVersion}>
                {t("updates.dialog.skipVersion")}
              </button>
              <button type="button" className="pref-button" onClick={handleSnoozeLater}>
                {t("updates.dialog.later")}
              </button>
              <button
                type="button"
                className="pref-button pref-button--primary"
                onClick={handleInstall}
              >
                {t("updates.dialog.installNow")}
              </button>
            </>
          )}
        </div>
      </Dialog>
    );
  };

  if (isBrowser) {
    return (
      <>
        <header className="preferences-content__heading">
          <h1>{t("updates.heading")}</h1>
          <p>{t("updates.subheading")}</p>
        </header>
        <Callout variant="info">
          <strong>{t("common.browserMode")}</strong>
          <span>{t("updates.browserCallout")}</span>
          <a href={t("app.downloadUrl")} target="_blank" rel="noopener noreferrer">
            {t("app.downloadLink")}
          </a>
        </Callout>
        <Section title={t("updates.about.heading")}>
          <div className="pref-meta-row">
            <span className="pref-meta-row__label">{t("updates.currentVersion")}</span>
            <span className="pref-meta-row__value">browser</span>
          </div>
        </Section>
      </>
    );
  }

  return (
    <>
      <header className="preferences-content__heading">
        <h1>{t("updates.heading")}</h1>
        <p>{t("updates.subheading")}</p>
      </header>

      <Section title={t("updates.heading")}>
        <div className="pref-meta-row">
          <span className="pref-meta-row__label">{t("updates.currentVersion")}</span>
          <span className="pref-meta-row__value">
            {appMetadata?.version ?? "(unknown)"}
            {appMetadata?.build ? ` (${appMetadata.build})` : ""}
          </span>
        </div>
        <div className="pref-meta-row">
          <span className="pref-meta-row__label">{t("updates.lastChecked")}</span>
          <span className="pref-meta-row__value">
            {lastCheckedRelative ?? t("updates.lastCheckedNever")}
          </span>
        </div>

        <FormRow
          label={t("updates.channel.label")}
          help={t("updates.channel.help")}
          control={
            <Segmented
              ariaLabel={t("updates.channel.label")}
              value={channel}
              onChange={handleChannelChange}
              options={[
                { value: "stable", label: t("updates.channel.stable") },
                { value: "beta", label: t("updates.channel.beta") },
              ]}
            />
          }
        />

        <FormRow
          label={t("updates.autoCheck.label")}
          help={t("updates.autoCheck.help")}
          control={
            <Toggle
              ariaLabel={t("updates.autoCheck.label")}
              checked={autoCheck}
              onChange={handleAutoCheckChange}
            />
          }
        />

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
          <button
            type="button"
            className="pref-button pref-button--primary"
            onClick={handleCheckNow}
            disabled={checkState === "checking"}
          >
            {checkState === "checking" ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="pref-spinner" aria-hidden="true" />
                {t("updates.checking")}
              </span>
            ) : (
              t("updates.checkNow")
            )}
          </button>

          <div
            className="pref-status-row"
            data-state={
              checkState === "up-to-date"
                ? "success"
                : checkState === "error"
                  ? "error"
                  : undefined
            }
          >
            {checkState === "up-to-date" ? t("updates.upToDate") : null}
            {checkState === "available" && latest?.latestVersion ? (
              <>{t("updates.updateAvailable", { version: latest.latestVersion })}</>
            ) : null}
            {checkState === "error" && errorKind ? (
              <>
                {errorKind === "signature"
                  ? t("updates.errors.signature")
                  : errorKind === "disk"
                    ? t("updates.errors.diskSpace")
                    : errorKind === "network"
                      ? t("updates.errors.network")
                      : (errorMessage ?? "Unknown error")}
              </>
            ) : null}
          </div>
        </div>

        {checkState === "error" ? (
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="button" className="pref-button" onClick={handleCheckNow}>
              {t("updates.errors.tryAgain")}
            </button>
            <button
              type="button"
              className="pref-button"
              onClick={() => bridge.openLogsFolder().catch(() => undefined)}
            >
              {t("updates.errors.viewLogs")}
            </button>
          </div>
        ) : null}
      </Section>

      <Section title={t("updates.about.heading")}>
        <div className="pref-meta-row">
          <span className="pref-meta-row__label">{t("updates.about.build")}</span>
          <span className="pref-meta-row__value">{appMetadata?.build ?? "(unknown)"}</span>
        </div>
        <div className="pref-meta-row">
          <span className="pref-meta-row__label">{t("updates.about.commit")}</span>
          <span className="pref-meta-row__value">{appMetadata?.commit ?? "(unknown)"}</span>
        </div>
        <ul className="pref-link-list" aria-label={t("updates.about.heading")}>
          <li>
            <a href="https://verified-skill.com" target="_blank" rel="noopener noreferrer">
              {t("updates.about.links.website")}
            </a>
          </li>
          <li>
            <a
              href="https://verified-skill.com/licenses"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("updates.about.links.openSource")}
            </a>
          </li>
          <li>
            <a
              href="https://verified-skill.com/acknowledgements"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("updates.about.links.acknowledgements")}
            </a>
          </li>
        </ul>
      </Section>

      {renderDialog()}
    </>
  );
}
