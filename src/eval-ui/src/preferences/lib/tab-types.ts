import type { ToastSpec } from "../components/primitives";
import type { DesktopBridge, SettingsSnapshot } from "./useDesktopBridge";

export interface TabProps {
  bridge: DesktopBridge;
  snapshot: SettingsSnapshot | null;
  onSnapshotChanged: () => Promise<void>;
  pushToast: (toast: Omit<ToastSpec, "id">) => void;
}
