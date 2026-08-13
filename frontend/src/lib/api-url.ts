const API_BASE = import.meta.env?.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

/** Resolve an application API path against the configured frontend API base. */
export function buildApiUrl(path: string) {
  return `${API_BASE}${path}`
}
