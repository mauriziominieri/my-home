import { useEffect, useState } from 'react';
import { setFirestoreWritesDisabled } from '../firebase';
import { NavSection } from '../types/home';

export type AppThemeMode = 'dark' | 'light';
export type GmailSyncIntervalMinutes = 5 | 10 | 15 | 30;
export type DefaultStartSection = NavSection | 'remember_last';

export interface AppSettings {
  theme: AppThemeMode;
  firestoreWritesDisabled: boolean;
  autoGmailSyncEnabled: boolean;
  autoGmailSyncIntervalMinutes: GmailSyncIntervalMinutes;
  sidebarAlwaysExpanded: boolean;
  compactDensity: boolean;
  defaultStartSection: DefaultStartSection;
  showInlineTooltips: boolean;
}

export const APP_SETTINGS_STORAGE_KEY = 'myhome_app_settings_v1';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  firestoreWritesDisabled: false,
  autoGmailSyncEnabled: true,
  autoGmailSyncIntervalMinutes: 10,
  sidebarAlwaysExpanded: false,
  compactDensity: false,
  defaultStartSection: 'remember_last',
  showInlineTooltips: true,
};

const VALID_INTERVALS: readonly GmailSyncIntervalMinutes[] = [5, 10, 15, 30];
const VALID_START_SECTIONS: readonly DefaultStartSection[] = [
  'remember_last',
  'panoramica',
  'domotica',
  'consumi',
  'bollette',
  'articoli',
  'ricerche',
  'documenti',
  'macchina',
  'spesa',
  'info',
  'impostazioni',
];

function sanitizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_APP_SETTINGS };
  const obj = raw as Partial<AppSettings>;
  const theme: AppThemeMode = obj.theme === 'light' ? 'light' : 'dark';
  const intervalRaw = Number(obj.autoGmailSyncIntervalMinutes);
  const autoGmailSyncIntervalMinutes: GmailSyncIntervalMinutes = VALID_INTERVALS.includes(
    intervalRaw as GmailSyncIntervalMinutes
  )
    ? (intervalRaw as GmailSyncIntervalMinutes)
    : DEFAULT_APP_SETTINGS.autoGmailSyncIntervalMinutes;

  const defaultStartSection: DefaultStartSection = VALID_START_SECTIONS.includes(
    obj.defaultStartSection as DefaultStartSection
  )
    ? (obj.defaultStartSection as DefaultStartSection)
    : DEFAULT_APP_SETTINGS.defaultStartSection;

  return {
    theme,
    firestoreWritesDisabled: Boolean(obj.firestoreWritesDisabled),
    autoGmailSyncEnabled:
      typeof obj.autoGmailSyncEnabled === 'boolean'
        ? obj.autoGmailSyncEnabled
        : DEFAULT_APP_SETTINGS.autoGmailSyncEnabled,
    autoGmailSyncIntervalMinutes,
    sidebarAlwaysExpanded: Boolean(obj.sidebarAlwaysExpanded),
    compactDensity: Boolean(obj.compactDensity),
    defaultStartSection,
    showInlineTooltips:
      typeof obj.showInlineTooltips === 'boolean'
        ? obj.showInlineTooltips
        : DEFAULT_APP_SETTINGS.showInlineTooltips,
  };
}

export function loadAppSettings(): AppSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_APP_SETTINGS };
  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

let currentSettings: AppSettings = loadAppSettings();
const listeners = new Set<(settings: AppSettings) => void>();

export function applyThemeToDocument(theme: AppThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }
}

export function initAppSettings(): AppSettings {
  currentSettings = loadAppSettings();
  applyThemeToDocument(currentSettings.theme);
  setFirestoreWritesDisabled(currentSettings.firestoreWritesDisabled);
  return currentSettings;
}

export function getAppSettings(): AppSettings {
  return currentSettings;
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  currentSettings = sanitizeSettings({ ...currentSettings, ...patch });
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
    } catch {
      // ignore localStorage quota errors
    }
  }
  applyThemeToDocument(currentSettings.theme);
  setFirestoreWritesDisabled(currentSettings.firestoreWritesDisabled);
  listeners.forEach((listener) => listener(currentSettings));
  return currentSettings;
}

export function resetAppSettings(): AppSettings {
  return updateAppSettings({ ...DEFAULT_APP_SETTINGS });
}

export function subscribeAppSettings(listener: (settings: AppSettings) => void): () => void {
  listeners.add(listener);
  listener(currentSettings);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppSettings(): {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;
} {
  const [settings, setSettings] = useState<AppSettings>(() => getAppSettings());

  useEffect(() => {
    return subscribeAppSettings(setSettings);
  }, []);

  return {
    settings,
    updateSettings: (patch) => {
      updateAppSettings(patch);
    },
    resetSettings: () => {
      resetAppSettings();
    },
  };
}
