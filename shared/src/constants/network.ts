/**
 * Network and server configuration constants
 */

export const PORTS = {
  BACKEND_DEFAULT: 1566,
  FRONTEND_DEFAULT: 1577,
  VITE_DEV: 5173,
} as const;

export const TIMEOUTS = {
  SERVER: 60000,          // 60 seconds
  KEEP_ALIVE: 65000,      // 65 seconds
  HEADERS: 66000,         // 66 seconds
  SHUTDOWN: 10000,        // 10 seconds
  REQUEST: 30000,         // 30 seconds (ComfyUI service)
} as const;

export const RATE_LIMITS = {
  WINDOW_MS: 60000,       // 1 minute
  MAX_REQUESTS: 1000,     // 1000 requests per window
} as const;
