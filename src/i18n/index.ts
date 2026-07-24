import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import idCommon from './locales/id/common.json';
import idOnboarding from './locales/id/onboarding.json';
import idDashboard from './locales/id/dashboard.json';
import idReports from './locales/id/reports.json';
import idProducts from './locales/id/products.json';
import idSettings from './locales/id/settings.json';
import idShifts from './locales/id/shifts.json';
import enCommon from './locales/en/common.json';
import enOnboarding from './locales/en/onboarding.json';
import enDashboard from './locales/en/dashboard.json';
import enReports from './locales/en/reports.json';
import enProducts from './locales/en/products.json';
import enSettings from './locales/en/settings.json';
import enShifts from './locales/en/shifts.json';
import msCommon from './locales/ms/common.json';
import msOnboarding from './locales/ms/onboarding.json';
import msDashboard from './locales/ms/dashboard.json';
import msReports from './locales/ms/reports.json';
import msProducts from './locales/ms/products.json';
import msSettings from './locales/ms/settings.json';
import msShifts from './locales/ms/shifts.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    debug: import.meta.env.DEV,
    fallbackLng: 'id',
    interpolation: { escapeValue: false },
    ns: ['common', 'onboarding', 'dashboard', 'reports', 'products', 'settings', 'shifts'],
    defaultNS: 'common',
    resources: {
      id: { common: idCommon, onboarding: idOnboarding, dashboard: idDashboard, reports: idReports, products: idProducts, settings: idSettings, shifts: idShifts },
      en: { common: enCommon, onboarding: enOnboarding, dashboard: enDashboard, reports: enReports, products: enProducts, settings: enSettings, shifts: enShifts },
      ms: { common: msCommon, onboarding: msOnboarding, dashboard: msDashboard, reports: msReports, products: msProducts, settings: msSettings, shifts: msShifts },
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
export type SupportedLanguage = 'id' | 'en' | 'ms';
export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; label: string; flag: string }[] = [
  { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ms', label: 'Bahasa Malaysia', flag: '🇲🇾' },
];
