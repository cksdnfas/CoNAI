/**
 * Network and server configuration constants
 */

export const PORTS = {
  BACKEND_DEFAULT: 1666,
  FRONTEND_DEFAULT: 1677,
} as const;

/** HTTP server socket timeouts. Keep-alive must outlive the request timeout, and headers must outlive keep-alive. */
export const TIMEOUTS = {
  SERVER: 60000,
  KEEP_ALIVE: 65000,
  HEADERS: 66000,
} as const;
