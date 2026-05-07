import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";

import "../styles/globals.css";
import "./styles.css";

import { i18n } from "./lib/i18n";
import { PreferencesApp } from "./PreferencesApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <PreferencesApp />
    </I18nextProvider>
  </StrictMode>,
);
