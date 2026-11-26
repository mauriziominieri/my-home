import { getAppSettings, sanitizeBackendApiUrl } from './appSettings';

let runtimeBackendUnavailable = false;

export function isStaticHostingOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname.endsWith('.github.io') ||
    (import.meta.env.BASE_URL || '/') !== '/'
  );
}

export function getConfiguredBackendBaseUrl(): string {
  const settingsUrl = sanitizeBackendApiUrl(getAppSettings().backendApiUrl);
  if (settingsUrl) return settingsUrl;
  const envUrl = sanitizeBackendApiUrl(
    (import.meta.env.VITE_API_BASE_URL as string | undefined) || ''
  );
  return envUrl;
}

export function markSameOriginBackendUnavailable(): void {
  runtimeBackendUnavailable = true;
}

export function resetBackendAvailabilityCache(): void {
  runtimeBackendUnavailable = false;
}

export function hasAvailableBackend(): boolean {
  if (getConfiguredBackendBaseUrl()) return true;
  if (isStaticHostingOrigin()) return false;
  return !runtimeBackendUnavailable;
}

/**
 * Resolves a backend API path such as `/api/researches/inspect`.
 * Returns `null` on static hosting (e.g. GitHub Pages) when no remote backend URL is configured.
 */
export function resolveApiUrl(apiPath: string): string | null {
  const cleanPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const configuredRemote = getConfiguredBackendBaseUrl();
  if (configuredRemote) {
    if (
      typeof window !== 'undefined' &&
      configuredRemote === window.location.origin
    ) {
      return cleanPath;
    }
    return `${configuredRemote}${cleanPath}`;
  }
  if (isStaticHostingOrigin() || runtimeBackendUnavailable) {
    return null;
  }
  return cleanPath;
}
