import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/inter-tight";

import "../styles/globals.css";
import "./styles.css";

import { LifecycleApp } from "./LifecycleApp";
import { InstancesApp } from "./InstancesApp";

// 0832: same lifecycle.html serves two modes — the modal (US-002) and the
// Window > Studio Instances submenu (US-003). Mode is selected by a query
// param so we can keep the build single-entrypoint.
const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") === "instances" ? "instances" : "modal";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {mode === "instances" ? <InstancesApp /> : <LifecycleApp />}
  </StrictMode>,
);
