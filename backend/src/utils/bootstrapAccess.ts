import crypto from 'crypto';
import type { Request } from 'express';

export const REMOTE_SETUP_TOKEN_HEADER = 'x-conai-setup-token';

/** Match loopback addresses without trusting user-controlled forwarding headers. */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) {
    return false;
  }

  const normalized = address.trim().toLowerCase();
  return normalized === '::1'
    || normalized === '0:0:0:0:0:0:0:1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized)
    || /^::ffff:127(?:\.\d{1,3}){3}$/.test(normalized);
}

/**
 * Bootstrap admin mode is a local-console convenience, not a network authentication mechanism.
 * Forwarded requests are intentionally excluded even when the reverse proxy itself is local.
 */
export function isDirectLoopbackRequest(req: Request): boolean {
  const hasForwardingHeaders = Boolean(req.headers.forwarded || req.headers['x-forwarded-for']);
  return !hasForwardingHeaders && isLoopbackAddress(req.socket?.remoteAddress);
}

/** Validate the opt-in token required for first-admin setup over a non-loopback connection. */
export function hasValidRemoteSetupToken(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const configuredToken = env.CONAI_SETUP_TOKEN?.trim();
  if (!configuredToken) {
    return false;
  }

  const rawHeader = req.headers[REMOTE_SETUP_TOKEN_HEADER];
  const providedToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof providedToken !== 'string') {
    return false;
  }

  const expected = Buffer.from(configuredToken);
  const provided = Buffer.from(providedToken.trim());
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}
