import i18next, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import enPreferences from "../locales/en/preferences.json";

export const i18n: I18nInstance = i18next.createInstance();

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: ["preferences"],
  defaultNS: "preferences",
  resources: {
    en: { preferences: enPreferences },
  },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(lng: string): void {
  void i18n.changeLanguage(lng);
}
