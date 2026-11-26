import { useEffect, useState } from 'react';
import { setFirestoreWritesDisabled } from '../firebase';
import { NavSection } from '../types/home';

export type AppThemeMode = 'dark' | 'light';
export type AppAccentPalette = 'sky' | 'amber' | 'emerald' | 'teal' | 'indigo';
export type DefaultStartSection = NavSection | 'remember_last';

export interface AppSettings {
  theme: AppThemeMode;
  accentPalette: AppAccentPalette;
  firestoreWritesDisabled: boolean;
  sidebarAlwaysExpanded: boolean;
  compactDensity: boolean;
  defaultStartSection: DefaultStartSection;
  showInlineTooltips: boolean;
}

export const APP_SETTINGS_STORAGE_KEY = 'myhome_app_settings_v2';
export const APP_SETTINGS_DOC_ID = 'app_settings_state';
export const SYSTEM_ROOM_APP_SETTINGS = '__app_settings__';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  accentPalette: 'sky',
  firestoreWritesDisabled: true,
  sidebarAlwaysExpanded: false,
  compactDensity: true,
  defaultStartSection: 'remember_last',
  showInlineTooltips: true,
};

const VALID_ACCENT_PALETTES: readonly AppAccentPalette[] = [
  'sky',
  'amber',
  'emerald',
  'teal',
  'indigo',
];

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
  const accentPalette: AppAccentPalette = VALID_ACCENT_PALETTES.includes(
    obj.accentPalette as AppAccentPalette
  )
    ? (obj.accentPalette as AppAccentPalette)
    : DEFAULT_APP_SETTINGS.accentPalette;

  const defaultStartSection: DefaultStartSection = VALID_START_SECTIONS.includes(
    obj.defaultStartSection as DefaultStartSection
  )
    ? (obj.defaultStartSection as DefaultStartSection)
    : DEFAULT_APP_SETTINGS.defaultStartSection;

  return {
    theme,
    accentPalette,
    firestoreWritesDisabled:
      typeof obj.firestoreWritesDisabled === 'boolean'
        ? obj.firestoreWritesDisabled
        : DEFAULT_APP_SETTINGS.firestoreWritesDisabled,
    sidebarAlwaysExpanded:
      typeof obj.sidebarAlwaysExpanded === 'boolean'
        ? obj.sidebarAlwaysExpanded
        : DEFAULT_APP_SETTINGS.sidebarAlwaysExpanded,
    compactDensity:
      typeof obj.compactDensity === 'boolean'
        ? obj.compactDensity
        : DEFAULT_APP_SETTINGS.compactDensity,
    defaultStartSection,
    showInlineTooltips:
      typeof obj.showInlineTooltips === 'boolean'
        ? obj.showInlineTooltips
        : DEFAULT_APP_SETTINGS.showInlineTooltips,
  };
}

function areSettingsEqual(a: AppSettings, b: AppSettings): boolean {
  return (
    a.theme === b.theme &&
    a.accentPalette === b.accentPalette &&
    a.firestoreWritesDisabled === b.firestoreWritesDisabled &&
    a.sidebarAlwaysExpanded === b.sidebarAlwaysExpanded &&
    a.compactDensity === b.compactDensity &&
    a.defaultStartSection === b.defaultStartSection &&
    a.showInlineTooltips === b.showInlineTooltips
  );
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
let cloudSettingsSaver: ((settings: AppSettings) => void) | null = null;

export function registerCloudSettingsSaver(
  saver: ((settings: AppSettings) => void) | null
): void {
  cloudSettingsSaver = saver;
}

export function applyThemeToDocument(
  theme: AppThemeMode,
  accentPalette: AppAccentPalette = currentSettings.accentPalette
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }
  root.setAttribute('data-accent', accentPalette);
}

function persistLocalAndApplySideEffects(next: AppSettings): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore localStorage quota errors
    }
  }
  applyThemeToDocument(next.theme, next.accentPalette);
  setFirestoreWritesDisabled(next.firestoreWritesDisabled);
  listeners.forEach((listener) => listener(next));
}

export function initAppSettings(): AppSettings {
  currentSettings = loadAppSettings();
  applyThemeToDocument(currentSettings.theme, currentSettings.accentPalette);
  setFirestoreWritesDisabled(currentSettings.firestoreWritesDisabled);
  return currentSettings;
}

export function getAppSettings(): AppSettings {
  return currentSettings;
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next = sanitizeSettings({ ...currentSettings, ...patch });
  currentSettings = next;
  persistLocalAndApplySideEffects(next);
  cloudSettingsSaver?.(next);
  return currentSettings;
}

export function applySyncedAppSettingsFromCloud(rawSpecs?: string | null): boolean {
  if (!rawSpecs) return false;
  try {
    const parsed = JSON.parse(rawSpecs);
    const next = sanitizeSettings(parsed);
    if (areSettingsEqual(currentSettings, next)) {
      return false;
    }
    currentSettings = next;
    persistLocalAndApplySideEffects(next);
    return true;
  } catch {
    return false;
  }
}

export function buildAppSettingsFirestorePayload(
  ownerId: string,
  settings: AppSettings,
  createdAt: unknown
): Record<string, unknown> {
  return {
    ownerId,
    name: 'Impostazioni App',
    brand: 'my-home',
    model: 'app_settings_v2',
    category: 'altro',
    room: SYSTEM_ROOM_APP_SETTINGS,
    familyWarranty: false,
    specs: JSON.stringify(sanitizeSettings(settings)).slice(0, 240),
    createdAt,
  };
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
