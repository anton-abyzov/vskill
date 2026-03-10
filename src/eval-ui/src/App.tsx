import { StudioProvider } from "./StudioContext";
import { StudioLayout } from "./components/StudioLayout";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";

export function App() {
  return (
    <StudioProvider>
      <StudioLayout
        left={<LeftPanel />}
        right={<RightPanel />}
      />
    </StudioProvider>
  );
}
