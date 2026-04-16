import { StudioProvider } from "./StudioContext";
import { ConfigProvider } from "./ConfigContext";
import { StudioLayout } from "./components/StudioLayout";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { UpdateToast } from "./components/UpdateToast";

export function App() {
  return (
    <ConfigProvider>
      <StudioProvider>
        <StudioLayout
          left={<LeftPanel />}
          right={<RightPanel />}
        />
        <UpdateToast />
      </StudioProvider>
    </ConfigProvider>
  );
}
