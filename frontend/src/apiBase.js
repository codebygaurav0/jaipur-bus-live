const DEFAULT_PRODUCTION_API_BASE = "https://jaipur-bus-live-5nvg.vercel.app";
const env = import.meta.env || {};

export function resolveApiBaseUrl(configuredBase, isDevelopment) {
  const configured = String(configuredBase || "").trim();
  const base = configured ||
    (isDevelopment ? "" : DEFAULT_PRODUCTION_API_BASE);
  return base.replace(/\/+$/, "");
}

export const API_BASE_URL = resolveApiBaseUrl(
  env.VITE_API_BASE_URL,
  env.DEV === true
);

export function apiUrl(path) {
  const normalizedPath = String(path || "");
  return `${API_BASE_URL}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
}
